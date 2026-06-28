type IframeContentProps = {
  title: string;
  url: string;
};

export function IframeContent({ title, url }: IframeContentProps) {
  return (
    <iframe
      title={title}
      src={url}
      className="h-full w-full border-0"
      allow="geolocation; microphone; camera; encrypted-media; storage-access *"
    />
  );
}
