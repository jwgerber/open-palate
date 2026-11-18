/**
 * The server's content (GET /api/content: the SCA flavor wheel plus the two
 * score sheets' wording) as module-level live bindings.
 *
 * The app loads it once at start (see `useContent` / ContentGate) and calls
 * `setContent`; every import below then reads the loaded value. Nothing
 * renders until it has been set, so a component never sees the empty defaults.
 * Column domains (score ranges, vote words, caps) are fixed in code, matching
 * `tasting/enums.py`.
 */
export const SHEETS = ['basic', 'advanced'];
export const ADV_MIN = 7.5;
export const ADV_MAX = 10.0;
export const ADV_DQ_VALUE = 7.0;
export const ADV_ANCHOR = 8.0;
export const BAR_VOTES = ['yes', 'maybe', 'no'];
export const MAX_TAGS_PER_CUP = 5;
export const CONSENSUS_THRESHOLD = 3;

export let KEY_SEP = '>';
export let FAMILY_HEX = {};
export let FAMILY_TINT = {};
export let DEFECT_TERMS = [];
export let PREPS = [];
export let PREP_LABELS = {};
export let KINDS = [];
export let KIND_LABELS = {};
export let PROCESSES = [];
export let PROCESS_LABELS = {};
export let ROASTS = [];
export let ROAST_LABELS = {};
export let ATTRIBUTES = [];
export let ATTRIBUTE_LABELS = {};
export let SCALE_WORDS = {};
export let ADV_CATEGORIES = [];
export let ADV_GROUPS = [];
export let ADV_GUIDANCE = {};
export let ADV_STEPS = [];
export let ADV_DQ = { label: 'D/Q', description: '' };
export let BAR_VOTE_LABELS = {};
export let ADV_VOTE_PROMPT = '';
/** key -> { key, label, family, tier, leaf, path, children: [key] } */
export let INDEX = {};
/** The family keys, in wheel order. */
export let ROOT_KEYS = [];
/** Every term for the search list. */
export let ALL_TERMS = [];

let loaded = false;
export const contentLoaded = () => loaded;

function buildIndex(tree, sep) {
  const index = {};
  const walk = (level, path, family) => level.map((node) => {
    const nodePath = [...path, node.label];
    const key = nodePath.join(sep);
    const familyKey = node.family || family;
    const children = node.children ? walk(node.children, nodePath, familyKey) : [];
    index[key] = {
      key, label: node.label, family: familyKey, tier: nodePath.length, leaf: children.length === 0,
      path: nodePath, children,
    };
    return key;
  });
  return { index, roots: walk(tree, [], 'other') };
}

const mapValues = (obj, fn) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));

/** Install the server's `{lexicon, forms}` body. */
export function setContent({ lexicon, forms }) {
  KEY_SEP = lexicon.key_separator;
  FAMILY_HEX = mapValues(lexicon.families, (f) => f.hex);
  FAMILY_TINT = mapValues(lexicon.families, (f) => f.tint);
  DEFECT_TERMS = lexicon.defects;
  PREPS = Object.keys(lexicon.preps);
  PREP_LABELS = lexicon.preps;
  KINDS = Object.keys(lexicon.kinds);
  KIND_LABELS = lexicon.kinds;
  PROCESSES = Object.keys(lexicon.processes);
  PROCESS_LABELS = lexicon.processes;
  ROASTS = Object.keys(lexicon.roasts);
  ROAST_LABELS = lexicon.roasts;
  ATTRIBUTES = forms.basic.attributes;
  ATTRIBUTE_LABELS = forms.basic.labels;
  SCALE_WORDS = forms.basic.scale_words;
  ADV_GROUPS = forms.advanced.groups.map((g) => [g.label, g.categories]);
  ADV_CATEGORIES = forms.advanced.groups.flatMap((g) => g.categories);
  ADV_GUIDANCE = forms.advanced.categories;
  ADV_STEPS = Object.keys(forms.advanced.steps).map(Number);
  ADV_DQ = forms.advanced.disqualified;
  BAR_VOTE_LABELS = forms.advanced.votes;
  ADV_VOTE_PROMPT = forms.advanced.vote_prompt;
  const built = buildIndex(lexicon.tree, KEY_SEP);
  INDEX = built.index;
  ROOT_KEYS = built.roots;
  ALL_TERMS = Object.values(INDEX);
  loaded = true;
}
