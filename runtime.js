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
    muted: 'hsl(240, 5%, 20%)',
    mutedForeground: 'hsl(240, 5%, 65%)',
    accentForeground: 'hsl(0, 0%, 98%)',
    primary: '#5d5fef',
    primaryLight: 'rgba(93, 95, 239, 0.15)',
    primaryMuted: 'rgba(93, 95, 239, 0.4)',
    primaryDashed: 'rgba(93, 95, 239, 0.7)', // More visible dashed border
    primaryHover: '#4a4cd4'
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
    if (!isActive || isToolbarOpen) return;
    
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
  
  function handleOverlayClick(event) {
    if (!isActive || isToolbarOpen) return;
    
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    
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
      // Normal click: Add to selection and show toolbar
      const existingIndex = selectedTaggedElements.findIndex(
        el => el.raccoonId === tagged.raccoonId
      );
      
      if (existingIndex === -1) {
        selectedTaggedElements.push(tagged);
        addSelectionHighlight(tagged.target, tagged.raccoonId);
      }
      
      isToolbarOpen = true;
      showToolbar(event.clientX, event.clientY);
    }
  }
  
  function showToolbar(x, y) {
    if (toolbar) return;
    
    toolbar = document.createElement('div');
    toolbar.className = 'raccoon-inspect-toolbar';
    toolbar.innerHTML = `
      <form class="raccoon-inspect-form">
        <input 
          type="text" 
          class="raccoon-inspect-input" 
          placeholder="Ask agent to make changes..."
          autocomplete="off"
        />
        <button type="submit" class="raccoon-inspect-submit">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </form>
    `;
    
    // Apply styles
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
    
    const form = toolbar.querySelector('.raccoon-inspect-form');
    Object.assign(form.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      margin: '0',
      padding: '0'
    });
    
    const input = toolbar.querySelector('.raccoon-inspect-input');
    Object.assign(input.style, {
      width: '220px',
      maxWidth: 'calc(100vw - 80px)',
      height: '28px',
      padding: '0 10px',
      border: 'none',
      background: COLORS.muted,
      color: COLORS.accentForeground,
      borderRadius: '5px',
      fontSize: '13px',
      outline: 'none',
      boxSizing: 'border-box'
    });
    
    const submitBtn = toolbar.querySelector('.raccoon-inspect-submit');
    Object.assign(submitBtn.style, {
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
    
    // Hover/active states for button
    submitBtn.addEventListener('mouseenter', () => {
      submitBtn.style.background = COLORS.muted;
      submitBtn.style.color = COLORS.accentForeground;
    });
    submitBtn.addEventListener('mouseleave', () => {
      submitBtn.style.background = 'transparent';
      submitBtn.style.color = COLORS.mutedForeground;
    });
    submitBtn.addEventListener('mousedown', () => {
      submitBtn.style.background = COLORS.primary;
      submitBtn.style.color = '#ffffff';
    });
    submitBtn.addEventListener('mouseup', () => {
      submitBtn.style.background = COLORS.muted;
      submitBtn.style.color = COLORS.accentForeground;
    });
    
    // Handle form submission
    form.addEventListener('submit', handleFormSubmit);
    
    // Handle cmd+enter or ctrl+enter on input to submit
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        form.dispatchEvent(new Event('submit'));
      }
    });
    
    // Prevent ALL keyboard events from bubbling up to iframe's global listeners
    // But handle Escape key first before stopping propagation
    toolbar.addEventListener('keydown', (e) => {
      // Handle Escape key to cancel
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        cancelSelection();
        return;
      }
      
      e.stopPropagation();
      e.stopImmediatePropagation();
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
    
    // Adjust horizontal position if toolbar would overflow right edge
    if (left + toolbarRect.width > viewportWidth - 10) {
      left = x - toolbarRect.width - 10;
    }
    // Adjust if still overflowing left
    if (left < 10) {
      left = 10;
    }
    
    // Adjust vertical position if toolbar would overflow bottom edge
    if (top + toolbarRect.height > viewportHeight - 10) {
      top = y - toolbarRect.height - 10;
    }
    // Adjust if still overflowing top
    if (top < 10) {
      top = 10;
    }
    
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
    
    // Trigger visibility animation
    requestAnimationFrame(() => {
      toolbar.style.opacity = '1';
      toolbar.style.transform = 'translateY(0) scale(1)';
      input.focus();
    });
  }
  
  function handleFormSubmit(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const input = toolbar?.querySelector('.raccoon-inspect-input');
    const query = input?.value?.trim() || '';
    
    // Validate non-empty selection
    if (selectedTaggedElements.length === 0) {
      // Show visual feedback - shake animation
      if (toolbar) {
        toolbar.style.animation = 'shake 0.3s';
        setTimeout(() => {
          if (toolbar) toolbar.style.animation = '';
        }, 300);
      }
      return;
    }
    
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
    selectedTaggedElements = [];
    cleanupOverlays();
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
    selectedTaggedElements = [];
    clearAllSelectionHighlights();
    cleanupOverlays();
  }
  
  function handleScrollResize() {
    if (scrollRafId !== null) return;
    
    scrollRafId = requestAnimationFrame(() => {
      updateSelectionHighlights();
      scrollRafId = null;
    });
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
    
    // Add scroll/resize handlers with RAF throttling
    window.addEventListener('scroll', handleScrollResize, true);
    window.addEventListener('resize', handleScrollResize);
    
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
    window.removeEventListener('scroll', handleScrollResize, true);
    window.removeEventListener('resize', handleScrollResize);
    
    if (overlayBlocker) {
      overlayBlocker.removeEventListener('mousemove', handlePointerMove, true);
      overlayBlocker.removeEventListener('click', handleOverlayClick, true);
      overlayBlocker.parentNode?.removeChild(overlayBlocker);
      overlayBlocker = null;
    }
    
    if (toolbar) {
      const form = toolbar.querySelector('.raccoon-inspect-form');
      if (form) {
        form.removeEventListener('submit', handleFormSubmit);
      }
      toolbar.parentNode?.removeChild(toolbar);
      toolbar = null;
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
