const legacySections = new Set([
  'components',
  'workshop',
  'library',
  'analytics',
  'scenarios',
  'typography',
]);

export function migrateLegacyUrl() {
  const url = new URL(window.location.href);
  if (url.pathname !== '/') return;
  if (legacySections.has(url.hash.slice(1)) || url.searchParams.has('view')) {
    url.pathname = '/design-system';
  } else if (url.searchParams.has('layout')) {
    url.searchParams.delete('layout');
  } else return;
  window.history.replaceState(null, '', url);
}
