import { Editor, StarterKit, Link, Underline, Highlight } from '../vendor/editors/tiptap.js';

window.TipTap = { Editor, StarterKit, Link, Underline, Highlight };
window.dispatchEvent(new Event('tiptap-ready'));
