// Load the renderer and its styles only when a map key is configured.
export async function loadMapSdk() {
  const [sdk] = await Promise.all([
    import('@maptiler/sdk'),
    import('@maptiler/sdk/dist/maptiler-sdk.css'),
  ]);
  return sdk;
}
