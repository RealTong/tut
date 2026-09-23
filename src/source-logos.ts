// Icons vendored from https://svgl.app; see public/logos/README.md.
const sourceLogoNames: Record<string, string> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  grok: 'grok',
  'grok-build': 'grok',
  'cursor-agent': 'cursor',
  cursor: 'cursor',
}

export function sourceLogo(source: string, theme: 'light' | 'dark') {
  const name = Object.hasOwn(sourceLogoNames, source) ? sourceLogoNames[source] : null
  return name ? `/logos/${name}${name === 'claude' ? '' : `-${theme}`}.svg` : null
}

export function sourceMonogram(source: string) {
  return source === 'pi' ? 'π' : source === 'omp' ? 'om' : source.slice(0, 2).toUpperCase()
}
