#!/usr/bin/env python3
"""
Генератор данных для карты (CSV -> GeoJSON).

Зачем это нужно:
Мы не хотим писать сложный сервер для карты. Этот скрипт позволяет нам 
удобно заполнять таблицу (CSV) руками, а потом запускать скрипт, 
чтобы он сам превратил её в правильный код для карты. И сайт остается бесплатным и простым.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


# --- Шаблон данных ---

@dataclass(frozen=True)
class PlaceRow:
    """
    Шаблон для одной строчки из нашей таблицы (одного места на карте).
    
    Зачем это нужно: 
    Мы говорим программе: "Каждое место обязано иметь ID, Имя, Координаты и т.д.". 
    Если в таблице будет ошибка, код сразу это заметит и не даст сломать сайт.
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


# --- Логика проверки данных ---

def _required(value: Optional[str], field: str, row_num: int) -> str:
    """
    Проверяет, чтобы важная ячейка в таблице не была пустой.
    Если пустая — программа выдаст ошибку с указанием номера строки.
    """
    if value is None or not str(value).strip():
        raise ValueError(f"CSV: пустое обязательное поле '{field}' (строка {row_num})")
    return str(value).strip()


def _to_int(value: str, field: str, row_num: int) -> int:
    """Проверяет, что ID (или другое числовое поле) это точно целое число."""
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"CSV: поле '{field}' должно быть целым числом (строка {row_num})") from exc


def _to_float(value: str, field: str, row_num: int) -> float:
    """Проверяет, что координаты - это числа (с точкой), а не текст."""
    try:
        return float(value)
    except ValueError as exc:
        raise ValueError(f"CSV: поле '{field}' должно быть числом с точкой (строка {row_num})") from exc


# --- Логика конвертации файла ---

def read_places_csv(csv_path: Path) -> List[PlaceRow]:
    """
    Открывает файл таблицы CSV, читает его строчку за строчкой и проверяет каждую.
    """
    places: List[PlaceRow] = []

    with csv_path.open(mode="r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)

        if reader.fieldnames is None:
            raise ValueError("CSV: не найдены заголовки колонок (первая строка)")

        # Читаем построчно. Начинаем считать со второй строки (start=2), потому что первая - это заголовки
        for row_num, row in enumerate(reader, start=2):
            
            # Проверяем каждую ячейку через наши функции-помощники
            pid = _to_int(_required(row.get("id"), "id", row_num), "id", row_num)
            name = _required(row.get("name"), "name", row_num)
            category = _required(row.get("category"), "category", row_num).lower()
            lat = _to_float(_required(row.get("lat"), "lat", row_num), "lat", row_num)
            lng = _to_float(_required(row.get("lng"), "lng", row_num), "lng", row_num)

            short_description = _required(row.get("shortDescription"), "shortDescription", row_num)
            full_description = _required(row.get("fullDescription"), "fullDescription", row_num)
            image = _required(row.get("image"), "image", row_num)
            difficulty = _required(row.get("difficulty"), "difficulty", row_num)

            # Если всё хорошо, собираем место по шаблону и добавляем в общий список
            places.append(
                PlaceRow(
                    id=pid, name=name, category=category, lat=lat, lng=lng,
                    short_description=short_description, full_description=full_description,
                    image=image, difficulty=difficulty,
                )
            )

    return places


def place_to_feature(place: PlaceRow) -> Dict[str, Any]:
    """
    Переводит одно место из нашего шаблона в специальный формат, который понимает веб-карта (GeoJSON).
    """
    # Важно: Формат карт требует, чтобы координаты шли строго в порядке [долгота, широта]. 
    # В таблице мы пишем как привыкли (широта, долгота), поэтому здесь мы меняем их местами.
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
    """Собирает все наши переведенные места в один большой список для карты."""
    return {"type": "FeatureCollection", "features": [place_to_feature(p) for p in places]}


def write_geojson(feature_collection: Dict[str, Any], out_path: Path) -> None:
    """
    Сохраняет готовые данные в новый файл.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Зачем это нужно: ensure_ascii=False очень важен, иначе русские буквы превратятся 
    # в непонятные коды (кракозябры), и файл станет невозможно читать глазами.
    out_path.write_text(json.dumps(feature_collection, ensure_ascii=False, indent=2), encoding="utf-8")


# --- Главный запуск ---

def main() -> int:
    """Главная функция, которая командует всем парадом."""
    root = Path(__file__).resolve().parents[1]
    csv_path = root / "data_preparation" / "places.csv"
    
    # Зачем это нужно: Мы сохраняем в файл '.generated.geojson', чтобы случайно не затереть 
    # главный рабочий файл карты, если вдруг в таблице была ошибка. Это защита "от дурака".
    out_geojson_path = root / "data" / "points.generated.geojson"

    places = read_places_csv(csv_path)                      # 1. Читаем таблицу
    feature_collection = build_feature_collection(places)   # 2. Переводим формат
    write_geojson(feature_collection, out_geojson_path)     # 3. Сохраняем в файл

    print(f"Всё супер: создано объектов: {len(places)}. Файл сохранен в -> {out_geojson_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())