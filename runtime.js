if (typeof window !== 'undefined' && !window.__sourceSelectorInitialized) {
  console.log('[raccoon-inspect] Runtime module loaded');
  window.__sourceSelectorInitialized = true;
  
  // Add shake animation CSS
  const style = document.createElement('style');
  style.textContent = `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-5px); }
      75% { transform: translateX(5px); }
    }
  `;
  document.head.appendChild(style);
  
  let isActive = false;
  let isToolbarOpen = false;
  let hoveredElement = null;
  let selectedTaggedElements = [];
  let selectionHighlights = new Map();
  let hoverHighlights = []; // Array of hover highlight elements
  let overlayBlocker = null;
  let overlayHighlight = null;
  let toolbar = null;
  let lastClickPosition = { x: 0, y: 0 };
  let scrollRafId = null;
  
  const COLORS = {
    card: 'hsl(240, 6%, 12%)',
    border: 'hsl(240, 6%, 18%)',
    borderSubtle: 'hsl(240, 6%, 15%)',
    muted: 'hsl(240, 6%, 14%)',
    mutedForeground: 'hsl(240, 5%, 55%)',
    foreground: 'hsl(240, 5%, 80%)',
    accentForeground: 'hsl(240, 5%, 93%)',
    primary: '#5d5fef',
    primaryLight: 'rgba(93, 95, 239, 0.15)',
    primaryMuted: 'rgba(93, 95, 239, 0.4)',
    primaryDashed: 'rgba(93, 95, 239, 0.7)',
    primaryHover: '#4a4cd4',
    destructive: '#ef4444',
    destructiveLight: 'rgba(239, 68, 68, 0.15)'
  };
  
  function elementToString(element) {
    const tagName = element.tagName.toLowerCase();
    const attrs = [];
    
    if (element.attributes && element.attributes.length > 0) {
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        const escapedValue = attr.value.replace(/"/g, '&quot;');
        attrs.push(`${attr.name}="${escapedValue}"`);
      }
    }
    
    const attrString = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    return `<${tagName}${attrString}>`;
  }
  
  function findTaggedElement(startElement) {
    let target = startElement;
    let attempts = 0;
    
    while (target && attempts < 10) {
      const component = target.getAttribute?.('data-source-component');
      const file = target.getAttribute?.('data-source-file');
      const line = target.getAttribute?.('data-source-line');
      const raccoonId = target.getAttribute?.('data-raccoon-id');
      
      if (component || file || line) {
        return { target, component, file, line, raccoonId };
      }
      
      target = target.parentElement;
      attempts++;
    }
    
    return null;
  }
  
  function getAllElementsWithRaccoonId(raccoonId) {
    if (!raccoonId) return [];
    return Array.from(document.querySelectorAll(`[data-raccoon-id="${raccoonId}"]`));
  }
  
  function postSelectionMessage(payload) {
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({
          type: 'SOURCE_SELECTED',
          data: payload
        }, '*');
      } catch (err) {
        console.warn('[raccoon-inspect] Failed to post message:', err);
      }
    }
  }
  
  function clearHoverHighlights() {
    hoverHighlights.forEach(h => {
      h.parentNode?.removeChild(h);
    });
    hoverHighlights = [];
  }
  
  function setHighlight(target) {
    // Clear any existing hover highlights
    clearHoverHighlights();
    
    if (!target) {
      return;
    }
    
    // Find all elements with the same raccoonId and show hover highlights for all
    const tagged = findTaggedElement(target);
    if (!tagged || !tagged.raccoonId) {
      return;
    }
    
    const allElements = getAllElementsWithRaccoonId(tagged.raccoonId);
    
    // If any element is selected, update its highlight style for hover
    if (isElementSelected(tagged.raccoonId)) {
      updateSelectionHighlightStyle(tagged.raccoonId, true);
      return;
    }
    
    // Create hover highlights for all matching elements
    allElements.forEach((elem) => {
      const highlight = document.createElement('div');
      highlight.style.position = 'fixed';
      highlight.style.border = `2px dashed ${COLORS.primaryDashed}`;
      highlight.style.borderRadius = '3px';
      highlight.style.opacity = '1';
      highlight.style.boxSizing = 'border-box';
      highlight.style.pointerEvents = 'none';
      highlight.style.zIndex = '2147483647';
      highlight.style.transition = 'opacity 0.12s ease';
      highlight.setAttribute('data-raccoon-hover', 'true');
      
      const rect = elem.getBoundingClientRect();
      highlight.style.left = `${rect.left}px`;
      highlight.style.top = `${rect.top}px`;
      highlight.style.width = `${rect.width}px`;
      highlight.style.height = `${rect.height}px`;
      
      document.body.appendChild(highlight);
      hoverHighlights.push(highlight);
    });
  }
  
  function isElementSelected(raccoonId) {
    return selectedTaggedElements.some(el => el.raccoonId === raccoonId);
  }
  
  function addSelectionHighlight(element, raccoonId) {
    if (!element || !raccoonId) return;
    
    // Remove existing highlights if present
    removeSelectionHighlight(raccoonId);
    
    // Find all elements with this raccoonId and create highlights for each
    const allElements = getAllElementsWithRaccoonId(raccoonId);
    const highlights = [];
    
    allElements.forEach((elem) => {
      const highlight = document.createElement('div');
      highlight.style.position = 'fixed';
      highlight.style.border = `1.5px solid ${COLORS.primary}`;
      highlight.style.borderRadius = '3px';
      highlight.style.boxShadow = `0 0 0 0.5px ${COLORS.primaryMuted}, 0 0 12px ${COLORS.primaryLight}`;
      highlight.style.boxSizing = 'border-box';
      highlight.style.pointerEvents = 'none';
      highlight.style.zIndex = '2147483647';
      highlight.style.transition = 'box-shadow 0.12s ease';
      highlight.setAttribute('data-raccoon-id', raccoonId);
      highlight.setAttribute('data-raccoon-highlight', 'true');
      
      const rect = elem.getBoundingClientRect();
      highlight.style.left = `${rect.left}px`;
      highlight.style.top = `${rect.top}px`;
      highlight.style.width = `${rect.width}px`;
      highlight.style.height = `${rect.height}px`;
      
      document.body.appendChild(highlight);
      highlights.push(highlight);
    });
    
    selectionHighlights.set(raccoonId, highlights);
  }
  
  function removeSelectionHighlight(raccoonId) {
    const highlights = selectionHighlights.get(raccoonId);
    if (highlights) {
      highlights.forEach((highlight) => {
        highlight.parentNode?.removeChild(highlight);
      });
      selectionHighlights.delete(raccoonId);
    }
  }
  
  function clearAllSelectionHighlights() {
    selectionHighlights.forEach((highlights) => {
      highlights.forEach((highlight) => {
        highlight.parentNode?.removeChild(highlight);
      });
    });
    selectionHighlights.clear();
  }
  
  function updateSelectionHighlights() {
    selectedTaggedElements.forEach((tagged) => {
      const highlights = selectionHighlights.get(tagged.raccoonId);
      if (highlights) {
        const allElements = getAllElementsWithRaccoonId(tagged.raccoonId);
        allElements.forEach((elem, index) => {
          if (highlights[index]) {
            const rect = elem.getBoundingClientRect();
            highlights[index].style.left = `${rect.left}px`;
            highlights[index].style.top = `${rect.top}px`;
            highlights[index].style.width = `${rect.width}px`;
            highlights[index].style.height = `${rect.height}px`;
          }
        });
      }
    });
  }
  
  function updateSelectionHighlightStyle(raccoonId, isHovered) {
    const highlights = selectionHighlights.get(raccoonId);
    if (!highlights) return;
    
    highlights.forEach((highlight) => {
      if (isHovered) {
        // Enhanced glow for selected + hovered (morph editing style)
        highlight.style.boxShadow = `0 0 0 0.5px ${COLORS.primaryMuted}, 0 0 16px ${COLORS.primaryLight}, inset 0 0 0 1px ${COLORS.primaryLight}`;
      } else {
        // Normal glow for selected only
        highlight.style.boxShadow = `0 0 0 0.5px ${COLORS.primaryMuted}, 0 0 12px ${COLORS.primaryLight}`;
      }
    });
  }
  
  function getUnderlyingElement(x, y) {
    const prevBlockerPointer = overlayBlocker?.style.pointerEvents;
    const prevBlockerVisibility = overlayBlocker?.style.visibility;
    const prevToolbarVisibility = toolbar?.style.visibility;
    
    // Store previous visibility states for selection highlights
    const selectionHighlightStates = new Map();
    selectionHighlights.forEach((highlights, raccoonId) => {
      const states = highlights.map(h => h.style.visibility);
      selectionHighlightStates.set(raccoonId, states);
      highlights.forEach(h => h.style.visibility = 'hidden');
    });
    
    // Hide hover highlights
    const hoverHighlightStates = hoverHighlights.map(h => h.style.visibility);
    hoverHighlights.forEach(h => h.style.visibility = 'hidden');
    
    if (overlayBlocker) {
      overlayBlocker.style.pointerEvents = 'none';
      overlayBlocker.style.visibility = 'hidden';
    }
    if (toolbar) {
      toolbar.style.visibility = 'hidden';
    }
    
    const element = document.elementFromPoint(x, y);
    
    if (overlayBlocker) {
      overlayBlocker.style.pointerEvents = prevBlockerPointer || 'auto';
      overlayBlocker.style.visibility = prevBlockerVisibility || 'visible';
    }
    if (toolbar) {
      toolbar.style.visibility = prevToolbarVisibility || 'visible';
    }
    
    // Restore selection highlights visibility
    selectionHighlights.forEach((highlights, raccoonId) => {
      const states = selectionHighlightStates.get(raccoonId) || [];
      highlights.forEach((h, i) => {
        h.style.visibility = states[i] || 'visible';
      });
    });
    
    // Restore hover highlights visibility
    hoverHighlights.forEach((h, i) => {
      h.style.visibility = hoverHighlightStates[i] || 'visible';
    });
    
    return element;
  }
  
  function handlePointerMove(event) {
    if (!isActive) return;

    // Don't show hover highlights when toolbar or input modal is open
    if (isToolbarOpen) {
      clearHoverHighlights();
      hoveredElement = null;
      return;
    }

    const underlying = getUnderlyingElement(event.clientX, event.clientY);
    if (!underlying || underlying === overlayBlocker || underlying === overlayHighlight) {
      // Reset any previously hovered selected element
      if (hoveredElement) {
        const prevTagged = findTaggedElement(hoveredElement);
        if (prevTagged && isElementSelected(prevTagged.raccoonId)) {
          updateSelectionHighlightStyle(prevTagged.raccoonId, false);
        }
      }
      hoveredElement = null;
      setHighlight(null);
      return;
    }

    if (hoveredElement !== underlying) {
      // Reset previous hovered element if it was selected
      if (hoveredElement) {
        const prevTagged = findTaggedElement(hoveredElement);
        if (prevTagged && isElementSelected(prevTagged.raccoonId)) {
          updateSelectionHighlightStyle(prevTagged.raccoonId, false);
        }
      }

      hoveredElement = underlying;
      setHighlight(hoveredElement);
    }
  }
  
  function hideToolbar() {
    if (toolbar) {
      toolbar.parentNode?.removeChild(toolbar);
      toolbar = null;
    }
    if (inputModal) {
      inputModal.parentNode?.removeChild(inputModal);
      inputModal = null;
    }
    isToolbarOpen = false;
    isInputMode = false;
  }

  function handleOverlayClick(event) {
    if (!isActive) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    // If input modal is open, just close it and return (don't select new element)
    if (isInputMode) {
      hideInputMode();
      return;
    }

    // If toolbar is open, close it and proceed to select new element
    if (isToolbarOpen) {
      hideToolbar();
    }

    const underlying = getUnderlyingElement(event.clientX, event.clientY);
    const tagged = underlying ? findTaggedElement(underlying) : null;

    if (!tagged) return;

    lastClickPosition = { x: event.clientX, y: event.clientY };
    
    if (event.shiftKey) {
      // Shift-click: Toggle selection
      const existingIndex = selectedTaggedElements.findIndex(
        el => el.raccoonId === tagged.raccoonId
      );
      
      if (existingIndex !== -1) {
        // Remove from selection
        selectedTaggedElements.splice(existingIndex, 1);
        removeSelectionHighlight(tagged.raccoonId);
      } else {
        // Add to selection
        selectedTaggedElements.push(tagged);
        addSelectionHighlight(tagged.target, tagged.raccoonId);
      }
    } else {
      // Normal click: Clear previous selections and select only this element
      clearAllSelectionHighlights();
      selectedTaggedElements = [tagged];
      addSelectionHighlight(tagged.target, tagged.raccoonId);

      isToolbarOpen = true;
      showToolbar(event.clientX, event.clientY);
    }
  }
  
  const ICONS = {
    copy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
    </svg>`,
    wand: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/>
      <path d="M17.8 11.8 19 13"/><path d="M15 9h0"/><path d="M17.8 6.2 19 5"/>
      <path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/>
    </svg>`,
    message: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
    </svg>`,
    send: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"></line>
      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
    </svg>`,
    check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>`,
    back: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>
    </svg>`
  };

  let isInputMode = false;

  function getElementsReferenceText() {
    return selectedTaggedElements
      .map((el) => `- Element: ${elementToString(el.target)}`)
      .join('\n');
  }

  function createToolbarButton(icon, title, onClick, isDestructive = false) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = icon;
    btn.title = title;
    Object.assign(btn.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '28px',
      height: '28px',
      border: 'none',
      background: 'transparent',
      color: COLORS.mutedForeground,
      borderRadius: '5px',
      cursor: 'pointer',
      transition: 'background 0.1s ease, color 0.1s ease'
    });

    btn.addEventListener('mouseenter', () => {
      if (isDestructive) {
        btn.style.background = COLORS.destructiveLight;
        btn.style.color = COLORS.destructive;
      } else {
        btn.style.background = COLORS.muted;
        btn.style.color = COLORS.accentForeground;
      }
    });
    btn.addEventListener('mouseleave', () => {
      if (!btn.dataset.active) {
        btn.style.background = 'transparent';
        btn.style.color = COLORS.mutedForeground;
      }
    });
    btn.addEventListener('mousedown', () => {
      btn.style.background = COLORS.borderSubtle;
    });
    btn.addEventListener('mouseup', () => {
      if (isDestructive) {
        btn.style.background = COLORS.destructiveLight;
        btn.style.color = COLORS.destructive;
      } else {
        btn.style.background = COLORS.muted;
        btn.style.color = COLORS.accentForeground;
      }
    });
    btn.addEventListener('click', onClick);

    return btn;
  }

  function createSeparator() {
    const sep = document.createElement('div');
    Object.assign(sep.style, {
      width: '1px',
      height: '18px',
      background: COLORS.borderSubtle,
      margin: '0 3px'
    });
    return sep;
  }

  function copyToClipboard(text) {
    // Fallback for iframes where Clipboard API is blocked
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
      return true;
    } catch (err) {
      console.warn('[raccoon-inspect] Copy failed:', err);
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }

  function handleCopyClick() {
    const text = getElementsReferenceText();
    const success = copyToClipboard(text);
    if (success) {
      const copyBtn = toolbar.querySelector('[data-action="copy"]');
      if (copyBtn) {
        copyBtn.innerHTML = ICONS.check;
        copyBtn.style.color = '#22c55e';
        setTimeout(() => {
          copyBtn.innerHTML = ICONS.copy;
          copyBtn.style.color = COLORS.mutedForeground;
        }, 1500);
      }
    }
  }

  function handleReimagineClick() {
    if (selectedTaggedElements.length === 0) return;

    postSelectionMessage({
      action: 'reimagine',
      elements: selectedTaggedElements.map(tagged => ({
        component: tagged.component || 'unknown',
        file: tagged.file || 'unknown',
        line: tagged.line || 'unknown',
        raccoonId: tagged.raccoonId || 'unknown',
        element: elementToString(tagged.target)
      })),
      query: 'Re-imagine this element with a fresh, modern design while keeping its functionality intact.'
    });

    isActive = false;
    isToolbarOpen = false;
    isInputMode = false;
    selectedTaggedElements = [];
    cleanupOverlays();
  }

  function handleAskClick() {
    showInputMode();
  }

  let inputModal = null;

  function showInputMode() {
    isInputMode = true;

    // Get toolbar position before hiding
    const toolbarRect = toolbar ? toolbar.getBoundingClientRect() : null;

    // Hide the toolbar
    if (toolbar) {
      toolbar.style.opacity = '0';
      toolbar.style.pointerEvents = 'none';
    }

    // Create the input modal
    inputModal = document.createElement('div');
    inputModal.className = 'raccoon-inspect-modal';

    Object.assign(inputModal.style, {
      position: 'fixed',
      width: '280px',
      maxWidth: 'calc(100vw - 40px)',
      padding: '8px',
      background: COLORS.card,
      border: `1px solid ${COLORS.border}`,
      borderRadius: '8px',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -2px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)',
      zIndex: '2147483647',
      opacity: '0',
      transform: 'scale(0.98)',
      transition: 'opacity 0.15s ease, transform 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    });

    // Header row with back button and title
    const headerRow = document.createElement('div');
    Object.assign(headerRow.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      marginBottom: '6px'
    });

    // Back button
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.innerHTML = ICONS.back;
    backBtn.title = 'Back to toolbar';
    Object.assign(backBtn.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '24px',
      height: '24px',
      border: 'none',
      background: 'transparent',
      color: COLORS.mutedForeground,
      borderRadius: '4px',
      cursor: 'pointer',
      transition: 'background 0.1s ease, color 0.1s ease',
      marginLeft: '-4px'
    });
    backBtn.addEventListener('mouseenter', () => {
      backBtn.style.background = COLORS.muted;
      backBtn.style.color = COLORS.accentForeground;
    });
    backBtn.addEventListener('mouseleave', () => {
      backBtn.style.background = 'transparent';
      backBtn.style.color = COLORS.mutedForeground;
    });
    backBtn.addEventListener('click', hideInputMode);

    // Title
    const title = document.createElement('div');
    title.textContent = 'Ask Agent';
    Object.assign(title.style, {
      fontSize: '11px',
      fontWeight: '500',
      color: COLORS.foreground
    });

    headerRow.appendChild(backBtn);
    headerRow.appendChild(title);

    // Textarea
    const textarea = document.createElement('textarea');
    textarea.className = 'raccoon-inspect-textarea';
    textarea.placeholder = 'Describe the changes you want to make...';
    Object.assign(textarea.style, {
      width: '100%',
      height: '80px',
      padding: '8px',
      border: `1px solid ${COLORS.borderSubtle}`,
      background: COLORS.muted,
      color: COLORS.accentForeground,
      borderRadius: '5px',
      fontSize: '12px',
      lineHeight: '1.5',
      outline: 'none',
      resize: 'none',
      boxSizing: 'border-box',
      fontFamily: 'inherit'
    });

    textarea.addEventListener('focus', () => {
      textarea.style.borderColor = COLORS.primary;
    });
    textarea.addEventListener('blur', () => {
      textarea.style.borderColor = COLORS.borderSubtle;
    });

    // Buttons container
    const buttonsRow = document.createElement('div');
    Object.assign(buttonsRow.style, {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '4px',
      marginTop: '6px'
    });

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    Object.assign(cancelBtn.style, {
      padding: '4px 10px',
      border: 'none',
      background: 'transparent',
      color: COLORS.mutedForeground,
      borderRadius: '5px',
      fontSize: '11px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.1s ease'
    });
    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.background = COLORS.muted;
      cancelBtn.style.color = COLORS.accentForeground;
    });
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.background = 'transparent';
      cancelBtn.style.color = COLORS.mutedForeground;
    });
    cancelBtn.addEventListener('click', hideInputMode);

    // Send button
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.textContent = 'Send';
    Object.assign(sendBtn.style, {
      padding: '4px 10px',
      border: 'none',
      background: COLORS.primary,
      color: '#ffffff',
      borderRadius: '5px',
      fontSize: '11px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.1s ease'
    });
    sendBtn.addEventListener('mouseenter', () => {
      sendBtn.style.background = COLORS.primaryHover;
    });
    sendBtn.addEventListener('mouseleave', () => {
      sendBtn.style.background = COLORS.primary;
    });
    sendBtn.addEventListener('click', () => {
      const query = textarea.value.trim();
      if (query) {
        submitQuery(query);
      }
    });

    buttonsRow.appendChild(cancelBtn);
    buttonsRow.appendChild(sendBtn);

    inputModal.appendChild(headerRow);
    inputModal.appendChild(textarea);
    inputModal.appendChild(buttonsRow);

    // Handle keyboard
    inputModal.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        hideInputMode();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const query = textarea.value.trim();
        if (query) {
          submitQuery(query);
        }
      }
    }, true);

    inputModal.addEventListener('keyup', (e) => {
      e.stopPropagation();
    }, true);

    inputModal.addEventListener('keypress', (e) => {
      e.stopPropagation();
    }, true);

    document.body.appendChild(inputModal);

    // Position modal at toolbar location
    const modalRect = inputModal.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left, top;

    if (toolbarRect) {
      // Position at the same location as toolbar
      left = toolbarRect.left;
      top = toolbarRect.top;
    } else {
      // Fallback to center
      left = (viewportWidth - modalRect.width) / 2;
      top = (viewportHeight - modalRect.height) / 2;
    }

    // Ensure modal stays within viewport
    if (left + modalRect.width > viewportWidth - 10) {
      left = viewportWidth - modalRect.width - 10;
    }
    if (left < 10) {
      left = 10;
    }
    if (top + modalRect.height > viewportHeight - 10) {
      top = viewportHeight - modalRect.height - 10;
    }
    if (top < 10) {
      top = 10;
    }

    inputModal.style.left = `${left}px`;
    inputModal.style.top = `${top}px`;

    requestAnimationFrame(() => {
      inputModal.style.opacity = '1';
      inputModal.style.transform = 'scale(1)';
      textarea.focus();
    });
  }

  function hideInputMode() {
    isInputMode = false;

    if (inputModal) {
      inputModal.style.opacity = '0';
      inputModal.style.transform = 'scale(0.95)';
      setTimeout(() => {
        inputModal.parentNode?.removeChild(inputModal);
        inputModal = null;
      }, 150);
    }

    // Show the toolbar again
    if (toolbar) {
      toolbar.style.opacity = '1';
      toolbar.style.pointerEvents = 'auto';
    }
  }

  function submitQuery(query) {
    if (selectedTaggedElements.length === 0) return;

    postSelectionMessage({
      elements: selectedTaggedElements.map(tagged => ({
        component: tagged.component || 'unknown',
        file: tagged.file || 'unknown',
        line: tagged.line || 'unknown',
        raccoonId: tagged.raccoonId || 'unknown',
        element: elementToString(tagged.target)
      })),
      query: query
    });

    isActive = false;
    isToolbarOpen = false;
    isInputMode = false;
    selectedTaggedElements = [];
    cleanupOverlays();
  }

  function showToolbar(x, y) {
    if (toolbar) return;

    toolbar = document.createElement('div');
    toolbar.className = 'raccoon-inspect-toolbar';

    // Copy button
    const copyBtn = createToolbarButton(ICONS.copy, 'Copy element reference', handleCopyClick);
    copyBtn.dataset.action = 'copy';

    // Separator between copy and action buttons
    const separator = createSeparator();

    // Re-imagine button
    const reimagineBtn = createToolbarButton(ICONS.wand, 'Re-imagine element', handleReimagineClick);
    reimagineBtn.dataset.action = 'reimagine';

    // Ask button
    const askBtn = createToolbarButton(ICONS.message, 'Ask agent', handleAskClick);
    askBtn.dataset.action = 'ask';

    toolbar.appendChild(copyBtn);
    toolbar.appendChild(separator);
    toolbar.appendChild(reimagineBtn);
    toolbar.appendChild(askBtn);

    // Apply toolbar styles
    Object.assign(toolbar.style, {
      position: 'fixed',
      display: 'flex',
      alignItems: 'center',
      gap: '1px',
      padding: '4px',
      background: COLORS.card,
      border: `1px solid ${COLORS.border}`,
      borderRadius: '8px',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -2px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)',
      zIndex: '2147483647',
      opacity: '0',
      pointerEvents: 'auto',
      transition: 'opacity 0.15s ease, transform 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
      transform: 'translateY(-2px) scale(0.98)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    });

    // Prevent keyboard events from bubbling, but handle Escape
    toolbar.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        cancelSelection();
        return;
      }
    }, true);

    toolbar.addEventListener('keyup', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, true);

    toolbar.addEventListener('keypress', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, true);

    document.body.appendChild(toolbar);

    // Position toolbar near click, ensuring it stays within viewport
    const toolbarRect = toolbar.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = x + 10;
    let top = y + 10;

    if (left + toolbarRect.width > viewportWidth - 10) {
      left = x - toolbarRect.width - 10;
    }
    if (left < 10) {
      left = 10;
    }
    if (top + toolbarRect.height > viewportHeight - 10) {
      top = y - toolbarRect.height - 10;
    }
    if (top < 10) {
      top = 10;
    }

    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;

    // Trigger visibility animation
    requestAnimationFrame(() => {
      toolbar.style.opacity = '1';
      toolbar.style.transform = 'translateY(0) scale(1)';
    });
  }
  
  function cancelSelection() {
    // Notify parent that selection was cancelled
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({
          type: 'SOURCE_SELECTOR_CANCELLED'
        }, '*');
      } catch (err) {
        console.warn('[raccoon-inspect] Failed to post cancellation message:', err);
      }
    }

    isActive = false;
    isToolbarOpen = false;
    isInputMode = false;
    selectedTaggedElements = [];
    clearAllSelectionHighlights();
    cleanupOverlays();
  }
  
  function handleScroll(event) {
    // Ignore scroll events from inside the toolbar or input modal
    if (toolbar && toolbar.contains(event.target)) {
      return;
    }
    if (inputModal && inputModal.contains(event.target)) {
      return;
    }

    if (scrollRafId !== null) return;

    scrollRafId = requestAnimationFrame(() => {
      // Close toolbar and clear selections on scroll - user can click again to reselect
      if (isToolbarOpen) {
        hideToolbar();
      }
      clearAllSelectionHighlights();
      selectedTaggedElements = [];
      scrollRafId = null;
    });
  }

  function handleResize() {
    // Only update highlights on resize, don't close toolbar
    requestAnimationFrame(() => {
      updateSelectionHighlights();
    });
  }
  
  function handleDocumentKeydown(event) {
    if (!isActive) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      // If input modal is open, close it first (go back to toolbar)
      if (isInputMode && inputModal) {
        hideInputMode();
      } else {
        cancelSelection();
      }
    }
  }

  function createOverlays() {
    if (overlayBlocker) return;

    overlayBlocker = document.createElement('div');
    overlayBlocker.style.position = 'fixed';
    overlayBlocker.style.inset = '0';
    overlayBlocker.style.zIndex = '2147483646';
    overlayBlocker.style.background = 'transparent';
    overlayBlocker.style.cursor = 'crosshair';
    overlayBlocker.style.userSelect = 'none';
    overlayBlocker.style.pointerEvents = 'auto';

    overlayBlocker.addEventListener('mousemove', handlePointerMove, true);
    overlayBlocker.addEventListener('click', handleOverlayClick, true);

    // Add scroll/resize handlers
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    // Add document-level Escape handler
    document.addEventListener('keydown', handleDocumentKeydown, true);

    document.body.appendChild(overlayBlocker);
  }
  
  function cleanupOverlays() {
    hoveredElement = null;
    selectedTaggedElements = [];
    clearAllSelectionHighlights();
    clearHoverHighlights();

    // Remove scroll/resize handlers
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
    window.removeEventListener('scroll', handleScroll, true);
    window.removeEventListener('resize', handleResize);

    // Remove document-level Escape handler
    document.removeEventListener('keydown', handleDocumentKeydown, true);
    
    if (overlayBlocker) {
      overlayBlocker.removeEventListener('mousemove', handlePointerMove, true);
      overlayBlocker.removeEventListener('click', handleOverlayClick, true);
      overlayBlocker.parentNode?.removeChild(overlayBlocker);
      overlayBlocker = null;
    }
    
    if (toolbar) {
      toolbar.parentNode?.removeChild(toolbar);
      toolbar = null;
    }

    if (inputModal) {
      inputModal.parentNode?.removeChild(inputModal);
      inputModal = null;
    }
  }

  function notifyParentReady() {
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({
          type: 'RACCOON_INSPECT_READY'
        }, '*');
      } catch (err) {
        console.warn('[raccoon-inspect] Failed to notify parent of ready state:', err);
      }
    }
  }
  
  function initSelector() {
    window.__sourceSelectorReady = true;
    
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'ENABLE_SOURCE_SELECTOR') {
        isActive = true;
        isToolbarOpen = false;
        selectedTaggedElements = [];
        clearAllSelectionHighlights();
        createOverlays();
      } else if (event.data?.type === 'DISABLE_SOURCE_SELECTOR') {
        isActive = false;
        isToolbarOpen = false;
        selectedTaggedElements = [];
        cleanupOverlays();
      } else if (event.data?.type === 'REQUEST_RACCOON_INSPECT_STATUS') {
        notifyParentReady();
      }
    });
    
    // Notify parent that runtime is ready
    notifyParentReady();
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSelector);
  } else {
    initSelector();
  }
}
