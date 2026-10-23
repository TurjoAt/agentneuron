const cache = new Map();

/** Convert a glob (supports **, *, ?, {a,b}, [..]) to an anchored, case-insensitive RegExp. */
export function globToRegex(glob) {
  if (cache.has(glob)) return cache.get(glob);
  let re = '';
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { braces++; re += '(?:'; }
    else if (c === '}' && braces > 0) { braces--; re += ')'; }
    else if (c === ',' && braces > 0) re += '|';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 1);
      if (end === -1) re += '\\[';
      else { re += '[' + glob.slice(i + 1, end).replace(/\\/g, '\\\\') + ']'; i = end; }
    } else if (/[.+^$()|\\\]]/.test(c)) re += '\\' + c;
    else re += c;
  }
  const rx = new RegExp('^' + re + '$', 'i');
  cache.set(glob, rx);
  return rx;
}

export function globMatch(glob, relPath) {
  return globToRegex(glob).test(relPath);
}
