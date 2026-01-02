module.exports = function ({ types: t }) {
    return {
      visitor: {
        Program: {
          enter(path, state) {
            state.fileName = state.file.opts.filename || 'unknown';
            state.componentStack = []; // Track nested components
            
            // Check if this file has JSX and should get the runtime
            const hasJSXInFile = hasJSX(path);
            if (!hasJSXInFile) return;
            
            // Check if file has "use server" directive (Next.js server-only file)
            const isServerOnly = path.node.directives?.some(
              directive => {
                const value = directive.value;
                return value && (
                  (typeof value === 'string' && value === 'use server') ||
                  (value.value === 'use server')
                );
              }
            );
            
            // Skip server-only files (runtime is client-side only)
            if (isServerOnly) return;
            
            // Check if runtime is already imported
            const hasRuntimeImport = path.node.body.some(node => {
              if (t.isImportDeclaration(node)) {
                const sourceValue = node.source.value;
                return sourceValue === 'raccoon-inspect/runtime' ||
                       sourceValue === './runtime' ||
                       sourceValue === '../runtime' ||
                       sourceValue.includes('raccoon-inspect/runtime');
              }
              return false;
            });
            
            if (!hasRuntimeImport) {
              // Inject the runtime import at the top of the file (after other imports)
              const runtimeImport = t.importDeclaration(
                [],
                t.stringLiteral('raccoon-inspect/runtime')
              );
              
              // Find the last import statement to insert after it
              let insertIndex = 0;
              for (let i = 0; i < path.node.body.length; i++) {
                if (t.isImportDeclaration(path.node.body[i])) {
                  insertIndex = i + 1;
                } else if (!t.isExpressionStatement(path.node.body[i])) {
                  // Stop at first non-import, non-directive statement
                  break;
                }
              }
              
              path.node.body.splice(insertIndex, 0, runtimeImport);
            }
          }
        },
        
        // 1. Add __source to FUNCTION COMPONENTS (Fiber-accessible)
        FunctionDeclaration: {
          enter(path, state) {
            if (!hasJSX(path)) return;
            
            const fileName = state.fileName;
            const line = path.node.loc?.start?.line || 1;
            const componentName = path.node.id?.name || 'AnonymousComponent';
            
            // Push component name onto stack for JSX elements to use
            state.componentStack.push(componentName);
            
            const sourceInfo = t.objectExpression([
              t.objectProperty(t.identifier('file'), t.stringLiteral(fileName)),
              t.objectProperty(t.identifier('line'), t.stringLiteral(line.toString())),
              t.objectProperty(t.identifier('name'), t.stringLiteral(componentName))
            ]);
            
            // Add static property OUTSIDE function body (module scope)
            const assignment = t.expressionStatement(
              t.assignmentExpression('=', 
                t.memberExpression(t.identifier(componentName), t.identifier('__source')),
                sourceInfo
              )
            );
            
            // Insert assignment right after the function declaration
            path.insertAfter(assignment);
          },
          exit(path, state) {
            if (!hasJSX(path)) return;
            // Pop component name from stack when exiting function
            state.componentStack.pop();
          }
        },

        // Handle arrow functions and function expressions (const Component = () => ...)
        ArrowFunctionExpression: {
          enter(path, state) {
            if (!hasJSX(path)) return;
            
            // Try to get the variable name if this is assigned to a variable
            const parent = path.parent;
            let componentName = inferJSXNameFromBody(path.node.body) || 'element';
            
            if (t.isVariableDeclarator(parent) && parent.id?.name) {
              componentName = parent.id.name;
            }
            
            state.componentStack.push(componentName);
          },
          exit(path, state) {
            if (!hasJSX(path)) return;
            state.componentStack.pop();
          }
        },

        FunctionExpression: {
          enter(path, state) {
            if (!hasJSX(path)) return;
            
            const parent = path.parent;
            let componentName = path.node.id?.name || 'AnonymousComponent';
            
            // If assigned to a variable, use that name
            if (t.isVariableDeclarator(parent) && parent.id?.name) {
              componentName = parent.id.name;
            }
            
            state.componentStack.push(componentName);
          },
          exit(path, state) {
            if (!hasJSX(path)) return;
            state.componentStack.pop();
          }
        },
  
        // 2. Add data-source attributes to JSX ELEMENTS (DOM + DevTools)
        JSXOpeningElement(path, state) {
          const fileName = state.fileName;
          const line = (path.node.loc?.start?.line || 1).toString();
          const componentName = state.componentStack[state.componentStack.length - 1] || 'unknown';
          
          // Add source metadata attributes to JSX elements
          path.node.attributes.push(
            t.jsxAttribute(
              t.jsxIdentifier('data-source-file'),
              t.stringLiteral(fileName)
            ),
            t.jsxAttribute(
              t.jsxIdentifier('data-source-line'),
              t.stringLiteral(line)
            ),
            t.jsxAttribute(
              t.jsxIdentifier('data-source-component'),
              t.stringLiteral(componentName)
            )
          );
        }
      }
    };
  };
  
  function jsxNameToString(nameNode) {
    if (!nameNode) return null;
    if (nameNode.type === 'JSXIdentifier') {
      return nameNode.name;
    }
    if (nameNode.type === 'JSXMemberExpression') {
      const objectName = jsxNameToString(nameNode.object);
      const propertyName = jsxNameToString(nameNode.property);
      if (objectName && propertyName) {
        return objectName + '.' + propertyName;
      }
      return null;
    }
    if (nameNode.type === 'JSXNamespacedName') {
      const ns = nameNode.namespace && nameNode.namespace.name;
      const name = nameNode.name && nameNode.name.name;
      if (ns && name) {
        return ns + ':' + name;
      }
      return null;
    }
    return null;
  }
  
  function inferJSXNameFromBody(bodyNode) {
    if (!bodyNode) return null;
    
    if (bodyNode.type === 'JSXElement') {
      return jsxNameToString(bodyNode.openingElement && bodyNode.openingElement.name);
    }
    if (bodyNode.type === 'JSXFragment') {
      return 'Fragment';
    }
    if (bodyNode.type === 'BlockStatement') {
      for (const stmt of bodyNode.body) {
        if (stmt.type === 'ReturnStatement' && stmt.argument) {
          const fromReturn = inferJSXNameFromBody(stmt.argument);
          if (fromReturn) return fromReturn;
        }
      }
    }
    return null;
  }
  
  function hasJSX(path) {
    let hasJSXElement = false;
    path.traverse({
      JSXElement() { hasJSXElement = true; }
    });
    return hasJSXElement;
  }
  