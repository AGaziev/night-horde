Готово. Копейщица полностью собрана по брифу:

- [исходник генерации](/Users/a.gaziev/src/modules/.tmp/vibe-survivors/sprites/_generated/spearmaiden.png)
- [итоговая лента 480×96](/Users/a.gaziev/src/modules/.tmp/vibe-survivors/sprites/out/spearmaiden.png)
- [маска плаща](/Users/a.gaziev/src/modules/.tmp/vibe-survivors/sprites/out/spearmaiden_mask.png)
- [проверочный лист](/Users/a.gaziev/src/modules/.tmp/vibe-survivors/sprites/shots/spearmaiden-check.png)
- [отдельный сборщик](/Users/a.gaziev/src/modules/.tmp/vibe-survivors/sprites/build_spearmaiden.py)
- [отчёт](/Users/a.gaziev/src/modules/.tmp/vibe-survivors/sprites/REPORT.md)

Проверено:

- 5 целых непересекающихся кадров;
- ровно 24 цвета, альфа только `0/255`;
- маска белая/прозрачная и непустая во всех кадрах;
- нижняя линия `y=92`, как у `knight`;
- прежние 30 записей манифеста не изменились, добавлена только `spearmaiden`;
- повторная сборка проходит.

Использована встроенная генерация. Запросы последовательно задавали пятикадровую копейщицу в стиле эталонов, увеличение тела относительно копья и выравнивание поз по пяти равным ячейкам.

