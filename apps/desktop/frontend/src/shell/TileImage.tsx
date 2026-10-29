import { useEffect, useState, type CSSProperties } from "react";
import { getAccessToken, isEdgeSession } from "@/auth/oidc";
import { FALLBACK_GLYPH, isApiTile, tileIconUrl, tileImageSrc } from "@/lib/tiles";

type TileImageProps = {
  icon: string | undefined;
  className?: string;
  alt?: string;
  style?: CSSProperties;
};

/**
 * A tile's picture, drawn only from what `tileImageSrc` admits.
 *
 * A picture this API serves needs the person's session. Behind the edge the
 * browser's cookie carries it and the address is used as it is; with a bearer
 * held in the page the picture is fetched with it and drawn from the bytes. A
 * picture that does not load shows the generic glyph.
 */
export function TileImage({ icon, className, alt = "", style }: TileImageProps) {
  const src = tileImageSrc(icon);
  const token = getAccessToken();
  const withBearer = isApiTile(src) && !isEdgeSession() && Boolean(token);
  // Until the bytes are in, the generic glyph: the address itself would be
  // asked without the bearer and refused.
  const [drawn, setDrawn] = useState(withBearer ? tileIconUrl(FALLBACK_GLYPH) : src);

  useEffect(() => {
    if (!withBearer) {
      setDrawn(src);
      return;
    }
    let objectUrl: string | null = null;
    let canceled = false;
    fetch(src, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (canceled) return;
        objectUrl = URL.createObjectURL(blob);
        setDrawn(objectUrl);
      })
      .catch(() => {
        if (!canceled) setDrawn(tileIconUrl(FALLBACK_GLYPH));
      });
    return () => {
      canceled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, token, withBearer]);

  return (
    <img
      className={className}
      src={drawn}
      alt={alt}
      draggable={false}
      style={style}
      onError={() => {
        const fallback = tileIconUrl(FALLBACK_GLYPH);
        if (drawn !== fallback) setDrawn(fallback);
      }}
    />
  );
}
