import { Editor } from 'https://esm.sh/@tiptap/core@2';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2';
import Link from 'https://esm.sh/@tiptap/extension-link@2';
import Underline from 'https://esm.sh/@tiptap/extension-underline@2';
import Highlight from 'https://esm.sh/@tiptap/extension-highlight@2';

window.TipTap = { Editor, StarterKit, Link, Underline, Highlight };
window.dispatchEvent(new Event('tiptap-ready'));
