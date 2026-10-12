# Methodology

## Data Sources

This dataset is compiled from multiple open sources:

- **ThangLeQuoc/vietnamese-provinces-database** (MIT) — Canonical post-2025 administrative spine with GSO codes, Vietnamese names (with diacritics), and English names per Decision 19/2025/QĐ-TTg
- **tranngocminhhieu/vietnamadminunits** (MIT) — Province-level coordinates (the only post-2025 source with lat/lon)
- **OpenStreetMap Nominatim** — Ward/commune-level geocoding (3,321 records, 100% success rate)

## Important: 2025 Administrative Reform

Vietnam underwent a major restructure effective 1 July 2025:
- **Districts (huyện/quận) were abolished** nationwide under Resolution 202/2025/QH15
- Provinces merged from 63 to **34 provincial units**
- Communes/wards consolidated from ~10,600 to **3,321 units**

Any source still based on 63 provinces or 708 districts is outdated. This dataset exclusively uses the post-reform structure.

## Processing

1. Administrative spine from ThangLeQuoc v3.0.2 (post-Decision 19)
2. Province coordinates from vietnamadminunits embedded parquet data
3. Ward/commune coordinates via Nominatim batch geocoding (100% hit rate)
4. English names: ASCII-folded Vietnamese for wards, well-known exonyms for major cities (Hanoi, Ho Chi Minh City, Hue, Da Nang, Hai Phong, Can Tho)
5. Multi-format export: JSON, NDJSON, CSV
6. Hierarchy folder structure with READMEs generated via EJS templates

## Code System

- Province: 2-digit GSO code (01 = Hà Nội, 79 = TP. Hồ Chí Minh)
- Ward/Commune: 5-digit GSO code (unique nationwide)

## Accuracy

- All names and codes from GSO via ThangLeQuoc (tracks Decision 19 in real-time)
- Coordinates: 100% at all levels
- Province count: 34 (verified against Decision 19)
- Ward/commune count: 3,321 (verified against Decision 19)
- Build script is idempotent: same input always produces same output