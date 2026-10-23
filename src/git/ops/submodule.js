import { bad } from '../params.js';
import { listSubmodules } from '../submodule/list.js';

// Submodules of the op's repo — the checkout, or a submodule named by target.sub (docs/submodules.md).

const noParams = (op) => (raw) => {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)) throw bad(`${op} takes no params`);
  return {};
};

export const ops = [
  {
    name: 'submodule.list',
    kind: 'read',
    params: noParams('submodule.list'),
    run: (git) => listSubmodules(git),
  },
];
