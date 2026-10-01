type MobileAppLayerProps = {
  url: string | null;
  title: string;
};

export function MobileAppLayer({ url, title }: MobileAppLayerProps) {
  if (!url) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-10 flex flex-col pb-14">
      <iframe
        title={title}
        src={url}
        className="h-full w-full flex-1 border-0 bg-white"
        allow="geolocation; microphone; camera; encrypted-media; storage-access *; notifications"
      />
    </div>
  );
}
