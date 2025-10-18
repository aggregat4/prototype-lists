const EMPTY_DRAG_IMAGE =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=";

export class FlipAnimator {
    snapshot(container, dragging) {
        const map = new Map();
        [...container.querySelectorAll("li")].forEach((li) => {
            if (li !== dragging) {
                map.set(li, li.getBoundingClientRect().top);
            }
        });
        return map;
    }

    play(container, dragging, prevTops) {
        if (!prevTops) return;
        [...container.querySelectorAll("li")].forEach((li) => {
            if (li === dragging) return;
            const prevTop = prevTops.get(li);
            if (prevTop == null) return;

            const nowTop = li.getBoundingClientRect().top;
            const dy = prevTop - nowTop;
            if (dy === 0) return;

            li.style.transform = `translateY(${dy}px)`;
            // force reflow so the browser picks up the initial transform before transitioning back
            // eslint-disable-next-line no-unused-expressions
            li.offsetHeight;

            li.classList.add("flip-animating");
            li.style.transform = "translateY(0)";

            const done = () => {
                li.classList.remove("flip-animating");
                li.style.transform = "";
                li.removeEventListener("transitionend", done);
            };
            li.addEventListener("transitionend", done, { once: true });
        });
    }
}

export default class DraggableBehavior {
    constructor(container, options = {}) {
        this.container = container;
        this.options = {
            handleClass: "handle",
            threshold: 10,
            onReorder: null,
            animator: null,
            ...options,
        };
        this.dragging = null;
        this.touchStartY = 0;
        this.touchStartX = 0;
        this.isTouchDragging = false;
        this.rafId = null;
        this.cachedItems = null;
        this.enabled = false;
        this.placeholder = null;
        this.originalPosition = null;
        this.pointerOffsetY = 0;
        this.pointerOffsetX = 0;
        this.animator = this.options.animator;
        this._currentPlaceholderIndex = null;
        this._dropHandled = false;

        this._onDragStart = this.handleDragStart.bind(this);
        this._onDragEnd = this.handleDragEnd.bind(this);
        this._onDragOver = this.handleDragOver.bind(this);
        this._onDrop = this.handleDrop.bind(this);

        this._onTouchStart = this.handleTouchStart.bind(this);
        this._onTouchMove = this.handleTouchMove.bind(this);
        this._onTouchEnd = this.handleTouchEnd.bind(this);

        this.deferFloatingInit = false;
        this._pendingInitCoords = null;
    }

    enable() {
        if (this.enabled) return;
        this.enabled = true;
        this.setupEventListeners();
    }

    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        this.removeEventListeners();
    }

    destroy() {
        this.disable();
        this.container = null;
    }

    setupEventListeners() {
        this.container.addEventListener("dragstart", this._onDragStart);
        this.container.addEventListener("dragend", this._onDragEnd);
        this.container.addEventListener("dragover", this._onDragOver);
        this.container.addEventListener("drop", this._onDrop);

        this.container.addEventListener("touchstart", this._onTouchStart, {
            passive: false,
        });
        this.container.addEventListener("touchmove", this._onTouchMove, {
            passive: false,
        });
        this.container.addEventListener("touchend", this._onTouchEnd, {
            passive: true,
        });
    }

    removeEventListeners() {
        this.container.removeEventListener("dragstart", this._onDragStart);
        this.container.removeEventListener("dragend", this._onDragEnd);
        this.container.removeEventListener("dragover", this._onDragOver);
        this.container.removeEventListener("drop", this._onDrop);

        this.container.removeEventListener("touchstart", this._onTouchStart);
        this.container.removeEventListener("touchmove", this._onTouchMove);
        this.container.removeEventListener("touchend", this._onTouchEnd);
    }

    handleDragStart(event) {
        const li = event.target.closest("li");
        if (!li) return;

        this.deferFloatingInit = true;
        this._pendingInitCoords = { x: event.clientX, y: event.clientY };

        this.startDrag(li);

        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", "");
            const emptyImg = document.createElement("img");
            emptyImg.src = EMPTY_DRAG_IMAGE;
            event.dataTransfer.setDragImage(emptyImg, 0, 0);
        }
    }

    handleDragEnd() {
        if (
            this.dragging &&
            !this._dropHandled &&
            this._currentPlaceholderIndex != null
        ) {
            const fromIndex = this.getIndex(this.dragging);
            const toIndex = this._currentPlaceholderIndex;
            if (fromIndex !== toIndex) {
                this.options.onReorder?.(fromIndex, toIndex);
                this._dropHandled = true;
                this.originalPosition = null;
            }
        }
        this.endDrag();
        this._dropHandled = false;
        this._currentPlaceholderIndex = null;
    }

    handleDragOver(event) {
        event.preventDefault();

        if (this.dragging && this.deferFloatingInit) {
            this.deferFloatingInit = false;
            const coords = this._pendingInitCoords || {
                x: event.clientX,
                y: event.clientY,
            };
            this.beginFloating(coords.x, coords.y);
            this._pendingInitCoords = null;
        }

        this.updateFloating(event.clientX, event.clientY);
        this.debouncedDragOver(event.clientY);
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
        }
    }

    handleDrop(event) {
        event.preventDefault();
        this.drop(event.clientY);
        this.endDrag();
    }

    handleTouchStart(event) {
        if (!event.target.classList.contains(this.options.handleClass)) return;
        const li = event.target.closest("li");
        if (!li) return;
        if (event.cancelable) event.preventDefault();
        this.touchStartY = event.touches[0].clientY;
        this.touchStartX = event.touches[0].clientX;
        this.isTouchDragging = false;
    }

    handleTouchMove(event) {
        if (!event.target.classList.contains(this.options.handleClass)) return;
        if (event.cancelable) event.preventDefault();

        const deltaY = event.touches[0].clientY - this.touchStartY;
        const deltaX = event.touches[0].clientX - this.touchStartX;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (!this.isTouchDragging && distance < this.options.threshold) {
            return;
        }

        if (!this.isTouchDragging) {
            this.isTouchDragging = true;
            const li = event.target.closest("li");
            if (!li) return;
            this.deferFloatingInit = false;
            this.startDrag(li, event.touches[0].clientX, event.touches[0].clientY);
        } else {
            this.updateFloating(event.touches[0].clientX, event.touches[0].clientY);
            this.debouncedDragOver(event.touches[0].clientY);
        }
    }

    handleTouchEnd(event) {
        if (this.isTouchDragging && this.dragging) {
            this.drop(event.changedTouches[0].clientY);
            this.endDrag();
        }
    }

    startDrag(li, startClientX = null, startClientY = null) {
        this.dragging = li;
        this.originalPosition = this.getIndex(li);
        this.invalidateItemsCache();
        this._currentPlaceholderIndex = this.originalPosition;
        this._dropHandled = false;

        if (!this.deferFloatingInit && startClientX != null && startClientY != null) {
            this.beginFloating(startClientX, startClientY);
        }
    }

    endDrag() {
        if (!this.dragging) return;

        if (this.originalPosition !== null && this.placeholder) {
            const children = Array.from(this.container.children).filter(
                (node) => node !== this.dragging,
            );
            const targetIndex = Math.min(this.originalPosition, children.length);
            const target = children[targetIndex] || null;
            this.container.insertBefore(this.placeholder, target);
        }

        if (this.placeholder) {
            this.container.insertBefore(this.dragging, this.placeholder);
        }

        this.endFloating();

        this.dragging = null;
        this.isTouchDragging = false;
        this.originalPosition = null;
        this.invalidateItemsCache();
    }

    dragOver(clientY) {
        if (!this.dragging) return;
        const after = this.getDropTarget(clientY);
        this.moveDraggedElement(after);
    }

    debouncedDragOver(clientY) {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = requestAnimationFrame(() => {
            this.dragOver(clientY);
            this.rafId = null;
        });
    }

    drop(clientY) {
        if (!this.dragging) return;
        const after = this.getDropTarget(clientY);
        this.moveDraggedElement(after);
        this.originalPosition = null;
        const draggedRef = this.dragging;
        draggedRef.classList.add("drop-animation");
        setTimeout(() => draggedRef.classList.remove("drop-animation"), 300);
        if (this.options.onReorder) {
            const items = Array.from(this.container.children);
            const toIndex = items.indexOf(this.placeholder);
            const fromIndex = this.getIndex(draggedRef);
            this.options.onReorder(fromIndex, toIndex);
        }
        this._dropHandled = true;
    }

    createPlaceholder(heightPx) {
        const placeholder = document.createElement("li");
        placeholder.className = "placeholder";
        placeholder.style.height = `${heightPx}px`;
        return placeholder;
    }

    beginFloating(eClientX, eClientY) {
        const li = this.dragging;
        const rect = li.getBoundingClientRect();

        this.placeholder = this.createPlaceholder(rect.height);
        this.container.insertBefore(this.placeholder, li);
        this._currentPlaceholderIndex = this.getIndex(this.placeholder);

        li.style.width = rect.width + "px";
        li.style.left = rect.left + "px";
        li.style.top = rect.top + "px";
        li.classList.add("dragging");

        this.pointerOffsetY =
            eClientY != null ? eClientY - rect.top : rect.height / 2;
        this.pointerOffsetX = eClientX != null ? eClientX - rect.left : 16;
    }

    updateFloating(eClientX, eClientY) {
        if (!this.dragging) return;
        const y = eClientY - this.pointerOffsetY;
        this.dragging.style.top = `${y}px`;
    }

    endFloating() {
        if (!this.dragging) return;
        const li = this.dragging;
        li.classList.remove("dragging");
        li.style.position = "";
        li.style.top = "";
        li.style.left = "";
        li.style.width = "";
        li.style.zIndex = "";
        li.style.pointerEvents = "";
        li.style.boxShadow = "";
        if (this.placeholder?.parentNode) {
            this.placeholder.parentNode.removeChild(this.placeholder);
        }
        this.placeholder = null;
    }

    getDropTarget(mouseY) {
        if (!this.cachedItems) {
            this.cachedItems = [
                ...this.container.querySelectorAll("li:not(.dragging):not(.placeholder)"),
            ];
        }
        if (this.cachedItems.length === 0) return null;

        let left = 0;
        let right = this.cachedItems.length;

        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            const rect = this.cachedItems[mid].getBoundingClientRect();
            const midY = rect.top + rect.height / 2;

            if (mouseY < midY) {
                right = mid;
            } else {
                left = mid + 1;
            }
        }

        return left < this.cachedItems.length ? this.cachedItems[left] : null;
    }

    getIndex(element) {
        return Array.from(this.container.children).indexOf(element);
    }

    invalidateItemsCache() {
        this.cachedItems = null;
    }

    moveDraggedElement(after) {
        if (!this.dragging || !this.placeholder) return;

        const prevSnapshot = this.animator?.snapshot(this.container, this.dragging);

        if (after == null) {
            this.container.appendChild(this.placeholder);
        } else {
            this.container.insertBefore(this.placeholder, after);
        }

        this.invalidateItemsCache();
        this._currentPlaceholderIndex = this.getIndex(this.placeholder);
        this.animator?.play(this.container, this.dragging, prevSnapshot);
    }

    cancel() {
        if (!this.dragging) return;
        this.endDrag();
    }
}
