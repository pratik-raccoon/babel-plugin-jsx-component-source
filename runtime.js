// Client-side runtime for source selector
// This file is imported by the Babel plugin and runs only in the browser

if (typeof window !== 'undefined' && !window.__sourceSelectorInitialized) {
    console.log('[raccoon-inspect] Runtime module loaded');
  window.__sourceSelectorInitialized = true;
  
  let isActive = false;
  let hoveredElement = null;
  let overlayBlocker = null;
  let overlayHighlight = null;
  
  function elementToString(element) {
    var tagName = element.tagName.toLowerCase();
    var attrs = [];
    
    if (element.attributes && element.attributes.length > 0) {
      for (var i = 0; i < element.attributes.length; i++) {
        var attr = element.attributes[i];
        var name = attr.name;
        var value = attr.value;
        var escapedValue = value.replace(/"/g, '&quot;');
        attrs.push(name + '="' + escapedValue + '"');
      }
    }
    
    var attrString = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    return '<' + tagName + attrString + '>';
  }
  
  function loadHtmlToImage() {
    return new Promise(function(resolve, reject) {
      if (window.htmlToImage) {
        resolve(window.htmlToImage);
        return;
      }
      if (window.__htmlToImageLoading) {
        window.__htmlToImageLoading.then(resolve).catch(reject);
        return;
      }
      window.__htmlToImageLoading = new Promise(function(loadResolve, loadReject) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js';
        script.onload = function() {
          if (window.htmlToImage) {
            loadResolve(window.htmlToImage);
          } else {
            loadReject(new Error('html-to-image failed to load'));
          }
        };
        script.onerror = function() {
          loadReject(new Error('Failed to load html-to-image'));
        };
        document.head.appendChild(script);
      });
      window.__htmlToImageLoading.then(resolve).catch(reject);
    });
  }
  
  function findTaggedElement(startElement) {
    let target = startElement;
    let attempts = 0;
    while (target && attempts < 10) {
      const component = target.getAttribute && target.getAttribute('data-source-component');
      const file = target.getAttribute && target.getAttribute('data-source-file');
      const line = target.getAttribute && target.getAttribute('data-source-line');
      if (component || file || line) {
        return { target, component, file, line };
      }
      target = target.parentElement;
      attempts++;
    }
    return null;
  }
  
  function postSelectionMessage(payload) {
    const messageData = {
      type: 'SOURCE_SELECTED',
      data: payload
    };
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage(messageData, '*');
      } catch (err) {
        // Silently fail cross-origin errors
      }
    }
  }
  
  function setHighlight(target) {
    if (!overlayHighlight) return;
    if (!target) {
      overlayHighlight.style.display = 'none';
      return;
    }
    const rect = target.getBoundingClientRect();
    overlayHighlight.style.display = 'block';
    overlayHighlight.style.left = rect.left + 'px';
    overlayHighlight.style.top = rect.top + 'px';
    overlayHighlight.style.width = rect.width + 'px';
    overlayHighlight.style.height = rect.height + 'px';
  }
  
  function getUnderlyingElement(x, y) {
    const prevBlockerPointer = overlayBlocker ? overlayBlocker.style.pointerEvents : null;
    const prevBlockerVisibility = overlayBlocker ? overlayBlocker.style.visibility : null;
    const prevHighlightVisibility = overlayHighlight ? overlayHighlight.style.visibility : null;
    
    if (overlayBlocker) {
      overlayBlocker.style.pointerEvents = 'none';
      overlayBlocker.style.visibility = 'hidden';
    }
    if (overlayHighlight) {
      overlayHighlight.style.visibility = 'hidden';
    }
    
    const element = document.elementFromPoint(x, y);
    
    if (overlayBlocker) {
      overlayBlocker.style.pointerEvents = prevBlockerPointer || 'auto';
      overlayBlocker.style.visibility = prevBlockerVisibility || 'visible';
    }
    if (overlayHighlight) {
      overlayHighlight.style.visibility = prevHighlightVisibility || 'visible';
    }
    
    return element;
  }
  
  function handlePointerMove(event) {
    if (!isActive) return;
    const underlying = getUnderlyingElement(event.clientX, event.clientY);
    if (!underlying || underlying === overlayBlocker || underlying === overlayHighlight) {
      hoveredElement = null;
      setHighlight(null);
      return;
    }
    if (hoveredElement !== underlying) {
      hoveredElement = underlying;
      setHighlight(hoveredElement);
    }
  }
  
  function handleOverlayClick(event) {
    if (!isActive) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) {
      event.stopImmediatePropagation();
    }
    
    const underlying = getUnderlyingElement(event.clientX, event.clientY);
    const tagged = underlying ? findTaggedElement(underlying) : null;
    if (!tagged) {
      return;
    }
    
    loadHtmlToImage().then(function(htmlToImage) {
      return htmlToImage.toPng(tagged.target, {
        cacheBust: true,
        pixelRatio: 1
      });
    }).then(function(dataUrl) {
      postSelectionMessage({
        component: tagged.component || 'unknown',
        file: tagged.file || 'unknown',
        line: tagged.line || 'unknown',
        screenshot: dataUrl,
        element: elementToString(tagged.target)
      });
    }).catch(function(err) {
      postSelectionMessage({
        component: tagged.component || 'unknown',
        file: tagged.file || 'unknown',
        line: tagged.line || 'unknown',
        screenshot: null,
        error: err.message || 'Unknown error',
        element: elementToString(tagged.target)
      });
    }).finally(function() {
      isActive = false;
      cleanupOverlays();
    });
  }
  
  function createOverlays() {
    if (overlayBlocker || overlayHighlight) return;
    
    overlayBlocker = document.createElement('div');
    overlayBlocker.style.position = 'fixed';
    overlayBlocker.style.inset = '0';
    overlayBlocker.style.zIndex = '2147483646';
    overlayBlocker.style.background = 'rgba(0,0,0,0)';
    overlayBlocker.style.cursor = 'crosshair';
    overlayBlocker.style.userSelect = 'none';
    overlayBlocker.style.pointerEvents = 'auto';
    
    overlayHighlight = document.createElement('div');
    overlayHighlight.style.position = 'fixed';
    overlayHighlight.style.border = '2px solid #4d5fef';
    overlayHighlight.style.boxSizing = 'border-box';
    overlayHighlight.style.pointerEvents = 'none';
    overlayHighlight.style.zIndex = '2147483647';
    overlayHighlight.style.display = 'none';
    
    overlayBlocker.addEventListener('mousemove', handlePointerMove, true);
    overlayBlocker.addEventListener('click', handleOverlayClick, true);
    
    document.body.appendChild(overlayBlocker);
    document.body.appendChild(overlayHighlight);
  }
  
  function cleanupOverlays() {
    hoveredElement = null;
    if (overlayBlocker) {
      overlayBlocker.removeEventListener('mousemove', handlePointerMove, true);
      overlayBlocker.removeEventListener('click', handleOverlayClick, true);
      if (overlayBlocker.parentNode) {
        overlayBlocker.parentNode.removeChild(overlayBlocker);
      }
      overlayBlocker = null;
    }
    if (overlayHighlight) {
      if (overlayHighlight.parentNode) {
        overlayHighlight.parentNode.removeChild(overlayHighlight);
      }
      overlayHighlight = null;
    }
  }
  
  function initSelector() {
    window.__sourceSelectorReady = true;
    
    window.addEventListener('message', function(event) {
      if (event.data && event.data.type === 'ENABLE_SOURCE_SELECTOR') {
        isActive = true;
        createOverlays();
      } else if (event.data && event.data.type === 'DISABLE_SOURCE_SELECTOR') {
        isActive = false;
        cleanupOverlays();
      }
    });
  }
  
  // Initialize after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSelector);
  } else {
    initSelector();
  }
}
