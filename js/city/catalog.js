/* ==========================================================================
   MetroSim — Alpha 0.9 · city/catalog.js
   Catálogo de HITOS: lo icónico que se ve al salir a la calle en cada
   estación (Mall Plaza Egaña, La Moneda, Costanera Center...).

   Solo datos (sin Three.js): los usan el plan de la calle, las misiones y
   el dibujo (city/landmarks.js). La clave es el nombre de la estación tal
   como aparece en engine/network.js; las estaciones con combinación
   comparten su hito en todas sus líneas.

   Para sumar una estación basta con agregar una entrada:
     name   nombre del lugar (aparece en el HUD y en las misiones)
     type   modelo procedural (ver BUILDERS en city/landmarks.js):
            mall · skyscraper · neoclassical · palace · monument · hill ·
            trainhall · cathedral · market · park · stadium · temple · church
     sign   letrero (opcional) · color  color principal (opcional)
     opciones propias de cada tipo (dome, statue, towers...)
     photo  frase al sacar la foto
   ========================================================================== */

export const LANDMARKS = {
  /* --- Línea 1 --- */
  "ESTACIÓN CENTRAL": {
    name: "Estación Central de Santiago", type: "trainhall", color: "#c9b48a",
    photo: "La gran nave de fierro de la Estación Central, de fines del siglo XIX",
  },
  "LOS HÉROES": {
    name: "Monumento a los Héroes de La Concepción", type: "monument", statue: "obelisk", color: "#9aa3a8",
    photo: "El monumento de la Alameda, en el corazón del barrio Los Héroes",
  },
  "LA MONEDA": {
    name: "Palacio de La Moneda", type: "palace", color: "#ece6d8", flag: true,
    photo: "El Palacio de La Moneda, sede del Gobierno de Chile",
  },
  "UNIVERSIDAD DE CHILE": {
    name: "Casa Central de la Universidad de Chile", type: "neoclassical", color: "#e7d7b4", sign: "UNIVERSIDAD DE CHILE",
    photo: "La Casa Central de la Universidad de Chile, frente a la Alameda",
  },
  "SANTA LUCÍA": {
    name: "Cerro Santa Lucía", type: "hill", color: "#c8b48c",
    photo: "La Terraza Neptuno del Cerro Santa Lucía",
  },
  "UNIVERSIDAD CATÓLICA": {
    name: "Casa Central UC", type: "neoclassical", color: "#d8cfbd", dome: true, sign: "PONTIFICIA UNIVERSIDAD CATÓLICA",
    photo: "La Casa Central de la Universidad Católica y su cúpula",
  },
  "BAQUEDANO": {
    name: "Plaza Baquedano", type: "monument", statue: "equestrian", color: "#6f7a6c",
    photo: "La Plaza Baquedano, punto de encuentro de Santiago",
  },
  "TOBALABA": {
    name: "Costanera Center", type: "skyscraper", sign: "COSTANERA CENTER",
    photo: "La Gran Torre Santiago, el edificio más alto de Sudamérica",
  },
  "ESCUELA MILITAR": {
    name: "Escuela Militar", type: "palace", color: "#d9c6a0", flag: true,
    photo: "La Escuela Militar del Libertador Bernardo O'Higgins",
  },
  "LOS DOMINICOS": {
    name: "Iglesia de Los Dominicos", type: "church", color: "#f2efe6",
    photo: "La iglesia colonial de Los Dominicos y su pueblito de artesanos",
  },

  /* --- Línea 2 --- */
  "FRANKLIN": {
    name: "Persa Bío Bío", type: "market", color: "#d95f3a", sign: "PERSA BÍO BÍO",
    photo: "El Persa Bío Bío, el mercado de las pulgas más famoso de Santiago",
  },

  /* --- Líneas 2 y 3 --- */
  "PUENTE CAL Y CANTO": {
    name: "Mercado Central", type: "market", color: "#e0b84a", sign: "MERCADO CENTRAL",
    photo: "La estructura de fierro del Mercado Central",
  },

  /* --- Línea 3 --- */
  "PLAZA DE ARMAS": {
    name: "Catedral Metropolitana", type: "cathedral", color: "#d8cdb6",
    photo: "La Catedral Metropolitana frente a la Plaza de Armas",
  },
  "PLAZA EGAÑA": {
    name: "Mall Plaza Egaña", type: "mall", color: "#1f9a52", sign: "MALL PLAZA EGAÑA",
    photo: "El Mall Plaza Egaña y su fachada verde",
  },

  /* --- Línea 4 --- */
  "BELLAVISTA DE LA FLORIDA": {
    name: "Mall Plaza Vespucio", type: "mall", color: "#1f9a52", sign: "MALL PLAZA VESPUCIO",
    photo: "El Mall Plaza Vespucio, en La Florida",
  },
  "PLAZA DE PUENTE ALTO": {
    name: "Plaza de Puente Alto", type: "church", color: "#e9dcc6",
    photo: "La parroquia frente a la Plaza de Puente Alto",
  },

  /* --- Línea 5 --- */
  "BELLAS ARTES": {
    name: "Museo Nacional de Bellas Artes", type: "neoclassical", color: "#e9e2d2", dome: true, sign: "MUSEO NACIONAL DE BELLAS ARTES",
    photo: "El Museo Nacional de Bellas Artes, en el Parque Forestal",
  },
  "QUINTA NORMAL": {
    name: "Parque Quinta Normal", type: "park", color: "#d6c9a8",
    photo: "La laguna del Parque Quinta Normal y el Museo de Historia Natural",
  },
  "PLAZA DE MAIPÚ": {
    name: "Templo Votivo de Maipú", type: "temple", color: "#cfc8bb",
    photo: "El Templo Votivo de Maipú y su torre",
  },

  /* --- Línea 6 --- */
  "ESTADIO NACIONAL": {
    name: "Estadio Nacional", type: "stadium", color: "#d4d0c6", sign: "ESTADIO NACIONAL",
    photo: "El Estadio Nacional Julio Martínez Prádanos",
  },
};

/** Hito de una estación (o null si su calle es genérica). */
export function landmarkFor(station) {
  return station ? LANDMARKS[station.name] || null : null;
}
