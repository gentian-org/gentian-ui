import { DEFAULT_SHELL_BACKGROUND } from "@/lib/background";

type BackgroundProps = {
  imageUrl?: string | null;
};

export function Background({ imageUrl }: BackgroundProps) {
  const url = imageUrl || DEFAULT_SHELL_BACKGROUND;

  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 bg-cover bg-top bg-no-repeat"
      aria-hidden="true"
      style={{ backgroundImage: `url('${url}')` }}
    />
  );
}
