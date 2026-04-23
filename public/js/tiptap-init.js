import { Editor } from 'https://esm.sh/@tiptap/core@2';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2';
import Link from 'https://esm.sh/@tiptap/extension-link@2';
import * as Y from 'https://esm.sh/yjs@13';
import { WebsocketProvider } from 'https://esm.sh/y-websocket@1.5';
import Collaboration from 'https://esm.sh/@tiptap/extension-collaboration@2';
import CollaborationCursor from 'https://esm.sh/@tiptap/extension-collaboration-cursor@2';

window.TipTap = { Editor, StarterKit, Link, Y, WebsocketProvider, Collaboration, CollaborationCursor };
window.dispatchEvent(new Event('tiptap-ready'));
