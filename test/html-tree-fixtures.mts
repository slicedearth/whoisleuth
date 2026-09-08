// Independent small document expectations shared by model and native-browser
// controls. Captured markup is synthetic and never fetched or executed.
export const HTML_TREE_FIXTURES = [
  {
    name: 'self-closing script syntax remains raw text',
    html: '<script/>const ignored = "<form action=https://collect.example/><input type=password>";</script><p>Visible</p>',
    forms: 0, passwordInputs: 0, handlers: 0,
  },
  {
    name: 'decoded quotes remain inside the original attribute',
    html: '<p data-note="&quot; onload=&quot;location.assign(0)">Visible</p>',
    forms: 0, passwordInputs: 0, handlers: 0,
  },
  {
    name: 'template fragments are inert',
    html: '<template><form action=https://collect.example/><input type=password><img onerror="0"></form></template><p>Visible</p>',
    forms: 0, passwordInputs: 0, handlers: 0,
  },
  {
    name: 'self-closing form syntax does not close an HTML form',
    html: '<form/><input type=password></form>',
    forms: 1, passwordInputs: 1, handlers: 0,
  },
  {
    name: 'nested forms use native tree construction',
    html: '<form id=outer><div><form id=ignored><input type=password></form></div></form>',
    forms: 1, passwordInputs: 1, handlers: 0,
  },
  {
    name: 'HTML integration points retain their namespace',
    html: '<svg><foreignObject><form><input type=password onfocus="0"></form></foreignObject></svg>',
    forms: 1, passwordInputs: 1, handlers: 1,
  },
  {
    name: 'raw fallback contents do not become evidence',
    html: '<iframe><input type=password></iframe><xmp><input type=password></xmp><textarea><input type=password></textarea>',
    forms: 0, passwordInputs: 0, handlers: 0,
  },
  {
    name: 'attribute greater-than signs do not invent tags',
    html: '<p data-rule="x>5 <form><input type=password>">Visible</p>',
    forms: 0, passwordInputs: 0, handlers: 0,
  },
] as const;
