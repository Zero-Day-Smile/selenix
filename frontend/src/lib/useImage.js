import { useEffect, useState } from 'react'

export function useImage(src) {
  const [img, setImg] = useState(null)
  useEffect(() => {
    if (!src) { setImg(null); return }
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => setImg(im)
    im.src = src
    return () => setImg(null)
  }, [src])
  return img
}
