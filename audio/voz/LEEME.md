# Voces de megafonía (opcional)

MetroSim dice las frases reales de los trenes del Metro de Santiago
(`js/announcements.js`). Sin grabaciones usa la voz sintetizada más realista
del navegador; **en Microsoft Edge** suele haber voces neuronales de Chile
(por ejemplo *Catalina*), que son las que mejor suenan.

Si quieres que suene con una voz grabada, pon aquí archivos de audio con
estos nombres y añade cada nombre (sin extensión) a la lista `clips` de
`manifest.json`. El juego los encadena y les aplica un filtro de altavoz de
tren. Un anuncio solo usa grabaciones si están **todos** sus fragmentos; si
falta alguno, ese anuncio se dice con voz sintetizada.

Usa grabaciones propias (por ejemplo, alguien que las lea) o audio con
permiso de uso. No incluyas grabaciones de Metro sin autorización.

| Archivo | Qué debe decir |
|---|---|
| `proxima-estacion.mp3` | Próxima estación |
| `cierre-puertas.mp3` | Se inicia el cierre de puertas |
| `permite-bajar.mp3` | Permite bajar antes de subir |
| `estacion-terminal.mp3` | Estación terminal, todos deben descender del tren |
| `no-olvides.mp3` | Que no se te olviden tus cosas, por tu preferencia muchas gracias |
| `viaje-seguro.mp3` | Para un viaje más seguro, por favor no te sientes en el suelo del tren |
| `estacion-3-plaza-quilicura.mp3` | Plaza Quilicura |
| `estacion-3-lo-cruzat.mp3` | Lo Cruzat |
| `estacion-3-ferrocarril.mp3` | Ferrocarril |
| `estacion-3-los-libertadores.mp3` | Los Libertadores |
| `estacion-3-cardenal-caro.mp3` | Cardenal Caro |
| `estacion-3-vivaceta.mp3` | Vivaceta |
| `estacion-3-conchali.mp3` | Conchalí |
| `estacion-3-plaza-chacabuco.mp3` | Plaza Chacabuco |
| `estacion-3-hospitales.mp3` | Hospitales |
| `estacion-3-puente-cal-y-canto.mp3` | Puente Cal y Canto |
| `estacion-3-plaza-de-armas.mp3` | Plaza de Armas |
| `estacion-3-universidad-de-chile.mp3` | Universidad de Chile |
| `estacion-3-parque-almagro.mp3` | Parque Almagro |
| `estacion-3-matta.mp3` | Matta |
| `estacion-3-irarrazaval.mp3` | Irarrázaval |
| `estacion-3-monsenor-eyzaguirre.mp3` | Monseñor Eyzaguirre |
| `estacion-3-nunoa.mp3` | Ñuñoa |
| `estacion-3-chile-espana.mp3` | Chile España |
| `estacion-3-villa-frei.mp3` | Villa Frei |
| `estacion-3-plaza-egana.mp3` | Plaza Egaña |
| `estacion-3-fernando-castillo-velasco.mp3` | Fernando Castillo Velasco |
| `combinacion-linea-2.mp3` | combinación a línea 2 |
| `combinacion-linea-5.mp3` | combinación a línea 5 |
| `combinacion-linea-1.mp3` | combinación a línea 1 |
| `combinacion-linea-6.mp3` | combinación a línea 6 |
| `combinacion-linea-4.mp3` | combinación a línea 4 |

Ejemplo de `manifest.json` con algunas grabaciones:

```json
{ "extension": "mp3", "clips": ["proxima-estacion", "estacion-plaza-de-armas", "combinacion-linea-5", "cierre-puertas"] }
```

## Grabaciones instaladas

Línea 1 completa (38 archivos, voz propia): las 6 frases generales,
`combinacion-linea-2` a `combinacion-linea-6` y `estacion-1-<estación>`
de San Pablo a Los Dominicos. Los nombres de estación llevan el número de
línea delante (`estacion-1-baquedano`, `estacion-3-plaza-de-armas`…).
