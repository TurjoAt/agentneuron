// Annotations API helpers (.agentneuron/annotations.json via /api/annotations).
import { api, post } from './api.js';
import { toast, app } from './store.svelte.js';
import { canRun, levelReason } from './actions.svelte.js';

export async function loadAnnotations(path) {
  try {
    const l = await api('/api/annotations', { path });
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}

function guard() {
  if (canRun('state')) return true;
  toast(levelReason('state'), 'warn', 5000);
  return false;
}

export async function addAnnotation(path, line, text) {
  if (!guard()) return null;
  try {
    const a = await post('/api/annotations', { path, line, text });
    app.annotTick++;
    return a;
  } catch (e) {
    toast(e.message, 'error');
    return null;
  }
}

export async function removeAnnotation(id) {
  if (!guard()) return;
  try {
    await post('/api/annotations/remove', { id });
    app.annotTick++;
  } catch (e) {
    toast(e.message, 'error');
  }
}

export async function resolveAnnotation(id, resolved = true) {
  if (!guard()) return;
  try {
    await post('/api/annotations/resolve', { id, resolved });
    app.annotTick++;
  } catch (e) {
    toast(e.message, 'error');
  }
}
