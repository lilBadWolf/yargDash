// Minimal hash router.
//   #            the dashboard (all controls)       #settings   settings
// Performer pages (no controls, for phones and screens; the QR button makes these):
//   #stage[/harm1|harm2|harm3]  lyrics      #tab[/<track id>]  tablature
//   #lanes                      every part's note highway (an audience screen)      #click  the drummer's click
import { reactive } from 'vue';

const MODES = { stage: 'lyrics', tab: 'tab', lanes: 'lanes', click: 'click' };
function parse() {
  const h = decodeURIComponent(location.hash.slice(1)).replace(/^yarg\/?/, ''); // old Live Console links (#yarg/stage) work too
  const m = h.match(/^(stage|click|tab|lanes)(?:\/([\w-]+))?$/);
  if (m) return { view: 'dash', artist: true, mode: MODES[m[1]], part: m[1] === 'stage' ? m[2] || null : null, tabTrack: m[1] === 'tab' ? m[2] || null : null };
  return { view: h === 'settings' ? 'settings' : 'dash', artist: false, mode: null, part: null, tabTrack: null };
}
export const route = reactive(parse());
window.addEventListener('hashchange', () => Object.assign(route, parse()));

export function go(view) { location.hash = view === 'dash' ? '' : view; }
