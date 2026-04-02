#!/usr/bin/env python3
"""
Генератор данных для карты (CSV -> GeoJSON).

Зачем это нужно:
- Проект остаётся статичным (HTML/CSS/JS) и спокойно деплоится на GitHub Pages.
- Наполнение/правки точек происходят в удобной таблице `places.csv`.
- Скрипт гарантирует корректный GeoJSON (типизация, координаты, единый формат свойств).
"""

from __future__ import annotations

import csv
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


@dataclass(frozen=True)
class PlaceRow:
    """
    Нормализованная строка входных данных.

    Мы отделяем "сырые" строки CSV от структуры данных, чтобы:
    - валидировать вход до генерации GeoJSON,
    - держать единый контракт полей,
    - избежать частичных/битых объектов в итоговом файле.
    """

    id: int
    name: str
    category: str
    lat: float
    lng: float
    short_description: str
    full_description: str
    image: str
    difficulty: str


def _required(value: Optional[str], field: str, row_num: int) -> str:
    """Проверяет обязательное поле и даёт понятную ошибку с номером строки."""

    if value is None or not str(value).strip():
        raise ValueError(f"CSV: пустое обязательное поле '{field}' (строка {row_num})")
    return str(value).strip()


def _to_int(value: str, field: str, row_num: int) -> int:
    """Парсит целое число, чтобы `id` был стабильным и сериализуемым."""

    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"CSV: поле '{field}' должно быть int (строка {row_num})") from exc


def _to_float(value: str, field: str, row_num: int) -> float:
    """Парсит число с плавающей точкой для координат."""

    try:
        return float(value)
    except ValueError as exc:
        raise ValueError(f"CSV: поле '{field}' должно быть float (строка {row_num})") from exc


def read_places_csv(csv_path: Path) -> List[PlaceRow]:
    """
    Читает `places.csv` и возвращает список нормализованных строк.

    Ожидаемые заголовки:
    id,name,category,lat,lng,shortDescription,fullDescription,image,difficulty
    """

    places: List[PlaceRow] = []

    with csv_path.open(mode="r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)

        if reader.fieldnames is None:
            raise ValueError("CSV: не найдены заголовки колонок (первая строка)")

        for row_num, row in enumerate(reader, start=2):
            # start=2, потому что строка 1 — заголовки, а пользователю важен "как в файле".
            pid = _to_int(_required(row.get("id"), "id", row_num), "id", row_num)
            name = _required(row.get("name"), "name", row_num)
            category = _required(row.get("category"), "category", row_num).lower()
            lat = _to_float(_required(row.get("lat"), "lat", row_num), "lat", row_num)
            lng = _to_float(_required(row.get("lng"), "lng", row_num), "lng", row_num)

            short_description = _required(row.get("shortDescription"), "shortDescription", row_num)
            full_description = _required(row.get("fullDescription"), "fullDescription", row_num)
            image = _required(row.get("image"), "image", row_num)
            difficulty = _required(row.get("difficulty"), "difficulty", row_num)

            places.append(
                PlaceRow(
                    id=pid,
                    name=name,
                    category=category,
                    lat=lat,
                    lng=lng,
                    short_description=short_description,
                    full_description=full_description,
                    image=image,
                    difficulty=difficulty,
                )
            )

    return places


def place_to_feature(place: PlaceRow) -> Dict[str, Any]:
    """
    Конвертирует одну запись в GeoJSON Feature.

    Важно: GeoJSON требует координаты в порядке [longitude, latitude] = [lng, lat].
    Это частый источник ошибок, поэтому фиксируем правило в одном месте.
    """

    return {
        "type": "Feature",
        "properties": {
            "id": place.id,
            "name": place.name,
            "category": place.category,
            "shortDescription": place.short_description,
            "fullDescription": place.full_description,
            "image": place.image,
            "difficulty": place.difficulty,
        },
        "geometry": {
            "type": "Point",
            "coordinates": [place.lng, place.lat],
        },
    }


def build_feature_collection(places: Iterable[PlaceRow]) -> Dict[str, Any]:
    """Собирает корректный GeoJSON FeatureCollection для карты."""

    features = [place_to_feature(p) for p in places]
    return {"type": "FeatureCollection", "features": features}


def write_geojson(feature_collection: Dict[str, Any], out_path: Path) -> None:
    """
    Записывает GeoJSON на диск, создавая папки при необходимости.

    `ensure_ascii=False` важен для кириллицы, иначе JSON станет нечитаемым.
    """

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(feature_collection, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    """
    CLI-точка входа.

    Скрипт специально без внешних зависимостей, чтобы его можно было запускать
    на защите "из коробки" обычным Python 3.
    """

    root = Path(__file__).resolve().parents[1]
    csv_path = root / "data_preparation" / "places.csv"
    # По умолчанию пишем в отдельный файл, чтобы случайно не “сломать” текущую карту.
    # Если нужно заменить основной датасет, можно вручную скопировать
    # `data/points.generated.geojson` -> `data/points.geojson`.
    out_geojson_path = root / "data" / "points.generated.geojson"

    places = read_places_csv(csv_path)
    feature_collection = build_feature_collection(places)
    write_geojson(feature_collection, out_geojson_path)

    print(f"OK: сгенерировано объектов: {len(places)} -> {out_geojson_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
