// One modal at a time, opened from anywhere: openModal('presets', { trackIdx, fxIdx })
import { reactive } from 'vue';

export const modal = reactive({ kind: null, props: {} });
export function openModal(kind, props = {}) { modal.kind = kind; modal.props = props; }
export function closeModal() { modal.kind = null; modal.props = {}; }
