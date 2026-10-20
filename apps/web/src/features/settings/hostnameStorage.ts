export const arrowcastHostnameKey = 'arrowcast.hostname';

export function getArrowcastHostname() {
  return localStorage.getItem(arrowcastHostnameKey) || window.location.origin;
}
