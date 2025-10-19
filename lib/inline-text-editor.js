// InlineTextEditor manages single-click editing for list item text content.
// We keep it custom so we can honor task keyboard shortcuts without fighting native inputs.
export default class InlineTextEditor {
  constructor(list, options = {}) {
    this.list = list;
    this.options = options;
    this.editingEl = null;
    this.initialTextValue = "";
    // Bind once so we can add/remove listeners without recreating closures.
    this.handleClick = this.handleClick.bind(this);
    this.handleBlur = this.handleBlur.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.list.addEventListener("click", this.handleClick);
  }

  destroy() {
    this.list.removeEventListener("click", this.handleClick);
    if (this.editingEl) {
      this.finishEditing(this.editingEl, true);
    }
    this.list = null;
  }

  handleClick(e) {
    const text = e.target.closest(".text");
    if (!text || !this.list.contains(text)) return;
    this.startEditing(text, e);
  }

  startEditing(textEl, triggerEvent = null, caretPreference = null) {
    if (this.editingEl === textEl) return;
    if (this.editingEl) {
      this.finishEditing(this.editingEl);
    }
    if (textEl.dataset.originalText != null) {
      textEl.textContent = textEl.dataset.originalText;
    } else {
      textEl.dataset.originalText = textEl.textContent;
    }
    // Remember the original text so callbacks get precise before/after values.
    this.initialTextValue = textEl.dataset.originalText ?? textEl.textContent;
    this.editingEl = textEl;
    const li = textEl.closest("li");
    if (li) {
      // Lock dragging while editing; otherwise pointer movement can cancel contenteditable.
      if (li.getAttribute("draggable") !== "false") {
        li.dataset.wasDraggable = "true";
        li.setAttribute("draggable", "false");
      }
      li.classList.add("editing");
    }
    textEl.setAttribute("contenteditable", "true");
    textEl.setAttribute("spellcheck", "false");
    textEl.addEventListener("blur", this.handleBlur);
    textEl.addEventListener("keydown", this.handleKeyDown);
    textEl.focus();
    if (caretPreference) {
      // When we resume editing after merges/moves we honour the stored caret preference.
      this.applyCaretPreference(textEl, caretPreference);
    } else {
      // Clicking should leave the caret where the user aimed.
      this.placeCaret(textEl, triggerEvent);
    }
  }

  placeCaret(element, triggerEvent) {
    const selection = window.getSelection();
    if (!selection) return;
    // Try to put the caret at the click position
    let range = null;
    if (
      triggerEvent &&
      typeof triggerEvent.clientX === "number" &&
      typeof triggerEvent.clientY === "number"
    ) {
      const doc = element.ownerDocument;
      if (doc.caretPositionFromPoint) {
        const pos = doc.caretPositionFromPoint(
          triggerEvent.clientX,
          triggerEvent.clientY
        );
        if (pos) {
          range = doc.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      } else if (doc.caretRangeFromPoint) {
        range = doc.caretRangeFromPoint(
          triggerEvent.clientX,
          triggerEvent.clientY
        );
        if (range && !range.collapsed) {
          range.collapse(true);
        }
      }
      if (range && !element.contains(range.startContainer)) {
        range = null;
      }
    }
    if (!range) {
      // Fall back to selecting the whole element so Escape will revert the edit cleanly.
      range = element.ownerDocument.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }

  handleBlur(e) {
    this.finishEditing(e.target);
  }

  handleKeyDown(e) {
    const textEl = e.target;
    if (!textEl) return;
    const fullText = textEl.textContent ?? "";
    const isMoveShortcut =
      (e.key === "ArrowDown" || e.key === "ArrowUp") &&
      !e.altKey &&
      (e.metaKey || e.ctrlKey);
    if (isMoveShortcut) {
      e.preventDefault();
      const { start, end } = this.getSelectionOffsets(textEl);
      this.options.onMove?.({
        element: textEl,
        direction: e.key === "ArrowDown" ? "down" : "up",
        selectionStart: start,
        selectionEnd: end,
      });
      return;
    }
    const isVerticalNav =
      (e.key === "ArrowDown" || e.key === "ArrowUp") &&
      !e.altKey &&
      !e.metaKey &&
      !e.ctrlKey;
    if (isVerticalNav) {
      const direction = e.key === "ArrowDown" ? "down" : "up";
      if (this.tryMoveVertical(textEl, direction)) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const { start, end } = this.getSelectionOffsets(textEl);
      const beforeText = fullText.slice(0, start);
      const afterText = fullText.slice(end);
      // Let the host materialise a new task while we keep the original span focused.
      if (typeof this.options.onSplit === "function") {
        this.options.onSplit({
          element: textEl,
          beforeText,
          afterText,
          previousText: this.initialTextValue,
          splitIndex: start,
        });
      }
      textEl.textContent = beforeText;
      textEl.dataset.originalText = beforeText;
      textEl.blur();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      textEl.blur();
      return;
    }
    const { start, end } = this.getSelectionOffsets(textEl);
    const selectionCollapsed = start === end;
    const isModKey = e.metaKey || e.ctrlKey;
    const isShortcutRemove = isModKey && !e.altKey && e.key === "Backspace";
    if (
      !isModKey &&
      !e.altKey &&
      e.key === "Backspace" &&
      selectionCollapsed &&
      start === 0 &&
      fullText.length > 0
    ) {
      const li = textEl.closest("li");
      let previousLi = li?.previousElementSibling ?? null;
      while (previousLi && previousLi.classList?.contains("placeholder")) {
        previousLi = previousLi.previousElementSibling ?? null;
      }
      const previousItemId = previousLi?.dataset?.itemId ?? null;
      if (previousItemId && typeof this.options.onMerge === "function") {
        e.preventDefault();
        this.finishEditing(textEl, true);
        textEl.blur();
        // Hand control to the store so item merges remain consistent with application state.
        const handled =
          this.options.onMerge({
            element: textEl,
            currentItemId: li?.dataset?.itemId ?? null,
            previousItemId,
            currentText: fullText,
            previousText: this.initialTextValue,
            selectionStart: start,
            selectionEnd: end,
            reason: "backspace-merge",
          }) === true;
        if (!handled) {
          this.startEditing(textEl);
        }
        return;
      }
    }
    const shouldRemoveEmptyBackspace =
      e.key === "Backspace" &&
      !isModKey &&
      !e.altKey &&
      fullText.length === 0 &&
      selectionCollapsed;
    const shouldRemoveByShortcut = isShortcutRemove;
    if (shouldRemoveEmptyBackspace || shouldRemoveByShortcut) {
      e.preventDefault();
      const reason = shouldRemoveByShortcut ? "shortcut" : "empty-backspace";
      this.finishEditing(textEl, true);
      textEl.blur();
      // Deleting here would desync the store, so we bubble intent to the host reducer.
      if (typeof this.options.onRemove === "function") {
        this.options.onRemove({
          element: textEl,
          previousText: this.initialTextValue,
          currentText: fullText,
          selectionStart: start,
          selectionEnd: end,
          reason,
        });
      }
      return;
    }
  }

  getSelectionOffsets(element) {
    const fallbackLength = element?.textContent?.length ?? 0;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return { start: fallbackLength, end: fallbackLength };
    }
    const range = selection.getRangeAt(0);
    if (
      !element.contains(range.startContainer) ||
      !element.contains(range.endContainer)
    ) {
      return { start: fallbackLength, end: fallbackLength };
    }
    const preStartRange = range.cloneRange();
    preStartRange.selectNodeContents(element);
    preStartRange.setEnd(range.startContainer, range.startOffset);
    const start = preStartRange.toString().length;
    const preEndRange = range.cloneRange();
    preEndRange.selectNodeContents(element);
    preEndRange.setEnd(range.endContainer, range.endOffset);
    const end = preEndRange.toString().length;
    return { start, end };
  }

  getCaretRect(element) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!range.collapsed) return null;
    if (!element.contains(range.startContainer)) return null;
    let rect = range.getBoundingClientRect();
    if (rect && (rect.width > 0 || rect.height > 0)) {
      return rect;
    }
    // Some browsers return zero-height rects at line boundaries; probe nearby content.
    const probe = range.cloneRange();
    const { startContainer, startOffset } = range;
    if (startContainer.nodeType === Node.TEXT_NODE) {
      const textLength = startContainer.textContent?.length ?? 0;
      if (startOffset < textLength) {
        probe.setEnd(startContainer, startOffset + 1);
      } else if (startOffset > 0) {
        probe.setStart(startContainer, startOffset - 1);
      } else {
        return element.getBoundingClientRect();
      }
    } else if (startContainer.childNodes[startOffset]) {
      probe.selectNode(startContainer.childNodes[startOffset]);
    } else {
      probe.selectNodeContents(element);
    }
    rect = probe.getBoundingClientRect();
    probe.detach?.();
    return rect;
  }

  tryMoveVertical(textEl, direction) {
    // Keep keyboard navigation consistent by moving focus to neighbouring items.
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!range.collapsed || !textEl.contains(range.startContainer))
      return false;
    const caretRect = this.getCaretRect(textEl);
    if (!caretRect) return false;
    const elementRect = textEl.getBoundingClientRect();
    const computedStyle = window.getComputedStyle
      ? window.getComputedStyle(textEl)
      : null;
    const paddingTop = computedStyle
      ? parseFloat(computedStyle.paddingTop) || 0
      : 0;
    const paddingBottom = computedStyle
      ? parseFloat(computedStyle.paddingBottom) || 0
      : 0;
    const contentTop = elementRect.top + paddingTop;
    const contentBottom = elementRect.bottom - paddingBottom;
    const tolerance = 2;
    if (
      direction === "down" &&
      caretRect.bottom < contentBottom - tolerance
    )
      return false;
    if (direction === "up" && caretRect.top > contentTop + tolerance)
      return false;
    const li = textEl.closest("li");
    if (!li) return false;
    let sibling =
      direction === "down" ? li.nextElementSibling : li.previousElementSibling;
    while (sibling && sibling.classList?.contains("placeholder")) {
      sibling =
        direction === "down"
          ? sibling.nextElementSibling
          : sibling.previousElementSibling;
    }
    const targetText = sibling?.querySelector?.(".text") ?? null;
    if (!targetText) return false;
    const offsets = this.getSelectionOffsets(textEl);
    const caretPref = {
      type: "caret-column",
      x: caretRect.left,
      bias: direction === "down" ? "start" : "end",
      fallbackOffset:
        typeof offsets?.start === "number" ? offsets.start : null,
    };
    // Remember current x so the next item can restore the caret column.
    this.finishEditing(textEl);
    textEl.blur();
    if (typeof this.options.onNavigate === "function") {
      this.options.onNavigate({
        direction,
        targetElement: targetText,
        preference: caretPref,
      });
    }
    this.startEditing(targetText, null, caretPref);
    return true;
  }

  setSelectionAtOffset(element, offset, bias = "start") {
    const selection = window.getSelection();
    if (!selection || !element) return false;
    const doc = element.ownerDocument ?? document;
    const totalLength = element.textContent?.length ?? 0;
    const desiredOffset =
      typeof offset === "number"
        ? Math.max(0, Math.min(offset, totalLength))
        : 0;
    const walker =
      doc.createTreeWalker?.(element, NodeFilter.SHOW_TEXT) ?? null;
    if (!walker) {
      const range = doc.createRange();
      range.selectNodeContents(element);
      range.collapse(bias === "end");
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
    let remaining = desiredOffset;
    let textNode = walker.nextNode();
    let lastTextNode = null;
    const range = doc.createRange();
    while (textNode) {
      const length = textNode.textContent?.length ?? 0;
      if (remaining <= length) {
        const finalOffset = Math.min(remaining, length);
        range.setStart(textNode, finalOffset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }
      remaining -= length;
      lastTextNode = textNode;
      textNode = walker.nextNode();
    }
    if (lastTextNode) {
      const length = lastTextNode.textContent?.length ?? 0;
      range.setStart(lastTextNode, length);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
    range.selectNodeContents(element);
    range.collapse(bias === "end");
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  placeCaretByPoint(element, preference) {
    const selection = window.getSelection();
    if (!selection || !element) return false;
    const rect = element.getBoundingClientRect();
    if (!rect) return false;
    const doc = element.ownerDocument ?? document;
    const bias = preference?.bias === "end" ? "end" : "start";
    const fallbackX = rect.left + rect.width / 2;
    const rawX =
      preference && typeof preference.x === "number"
        ? preference.x
        : fallbackX;
    const clampLeft = rect.left + 1;
    const clampRight = rect.right - 1;
    const xCoord =
      clampLeft < clampRight
        ? Math.min(Math.max(rawX, clampLeft), clampRight)
        : rect.left;
    const yCoord = bias === "end" ? rect.bottom - 2 : rect.top + 2;
    let range = null;
    if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(xCoord, yCoord);
      if (pos && element.contains(pos.offsetNode)) {
        range = doc.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    } else if (doc.caretRangeFromPoint) {
      const tentative = doc.caretRangeFromPoint(xCoord, yCoord);
      if (tentative) {
        tentative.collapse(true);
        if (element.contains(tentative.startContainer)) {
          range = tentative;
        }
      }
    }
    if (!range || !element.contains(range.startContainer)) {
      return false;
    }
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  applyCaretPreference(element, preference) {
    if (preference === "start") {
      this.setSelectionAtOffset(element, 0, "start");
      return;
    }
    if (preference === "end") {
      const length = element?.textContent?.length ?? 0;
      this.setSelectionAtOffset(element, length, "end");
      return;
    }
    if (
      preference &&
      typeof preference === "object" &&
      preference.type === "offset" &&
      typeof preference.value === "number"
    ) {
      this.setSelectionAtOffset(element, preference.value, preference.bias);
      return;
    }
    if (
      preference &&
      typeof preference === "object" &&
      preference.type === "caret-column"
    ) {
      const length = element?.textContent?.length ?? 0;
      const desiredX =
        typeof preference.x === "number" ? preference.x : null;
      const fallbackOffset =
        typeof preference.fallbackOffset === "number"
          ? Math.max(0, Math.min(preference.fallbackOffset, length))
          : preference.bias === "end"
            ? length
            : 0;
      if (desiredX != null) {
        const placed = this.placeCaretByPoint(element, preference);
        if (placed) {
          const caretRect = this.getCaretRect(element);
          if (caretRect && Math.abs(caretRect.left - desiredX) <= 2) {
            return;
          }
        }
      }
      if (this.setSelectionAtOffset(element, fallbackOffset, preference.bias)) {
        return;
      }
    }
    this.placeCaret(element, null);
  }

  finishEditing(textEl, skipCallback = false) {
    if (!textEl || this.editingEl !== textEl) return;
    const previousText = this.initialTextValue;
    textEl.removeEventListener("blur", this.handleBlur);
    textEl.removeEventListener("keydown", this.handleKeyDown);
    textEl.removeAttribute("contenteditable");
    textEl.removeAttribute("spellcheck");
    textEl.dataset.originalText = textEl.textContent;
    const newText = textEl.textContent;
    const li = textEl.closest("li");
    if (li) {
      // Restore drag affordances once editing is over.
      li.classList.remove("editing");
      if (li.dataset.wasDraggable) {
        li.setAttribute("draggable", "true");
        delete li.dataset.wasDraggable;
      }
    }
    this.editingEl = null;
    this.initialTextValue = "";
    if (!skipCallback && typeof this.options.onCommit === "function") {
      this.options.onCommit({
        element: textEl,
        previousText,
        newText,
      });
    }
  }
}
