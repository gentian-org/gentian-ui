type BackgroundProps = {
  imageUrl?: string | null;
};

export function Background({ imageUrl }: BackgroundProps) {
  const style = imageUrl
    ? { backgroundImage: `url(${imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: "linear-gradient(160deg, var(--gtn-700) 0%, var(--gtn-500) 45%, #3d3db8 100%)" };

  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10"
      aria-hidden="true"
      style={style}
    />
  );
}
