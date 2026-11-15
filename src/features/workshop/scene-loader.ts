let scene: ReturnType<typeof importScene> | undefined;
const importScene = () => import('./IsoView');

export function preloadWorkshopScene() {
  return (scene ??= importScene().catch((error) => {
    scene = undefined;
    throw error;
  }));
}
