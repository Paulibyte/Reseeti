// Every image-upload point in the app (product photos, business logo,
// signature, the AI receipt scanner) calls this instead of hardcoding
// its own size limit. Fetched once per page load and cached in memory
// — a setting that rarely changes doesn't need a fresh network request
// for every single file someone picks, and an inflight-request guard
// means several upload fields on the same page (e.g. logo + signature
// on Business Settings) triggering this at nearly the same moment
// still only cost one real request between them.
//
// Falls back to 2MB if the fetch fails for any reason — a real,
// deliberate choice: failing toward the OLD, safe default rather than
// either silently allowing unlimited uploads or blocking every upload
// outright just because this one settings fetch had a bad moment.
let cachedMb = null;
let inflight = null;

export async function getMaxImageUploadMb() {
  if (cachedMb !== null) return cachedMb;
  if (!inflight) {
    inflight = fetch('/api/settings/upload-limits')
      .then((res) => res.json())
      .then((data) => {
        cachedMb = Number(data?.maxImageUploadMb) || 2;
        return cachedMb;
      })
      .catch(() => {
        cachedMb = 2;
        return cachedMb;
      });
  }
  return inflight;
}

export async function getMaxImageUploadBytes() {
  const mb = await getMaxImageUploadMb();
  return mb * 1024 * 1024;
}
