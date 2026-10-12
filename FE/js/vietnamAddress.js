export async function loadVietnamAddress() {
  const url = new URL("../data/hierarchy.json", import.meta.url);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Không thể tải hierarchy.json: HTTP ${response.status}`);
  }

  const json = await response.json();

  return json.data;
}
