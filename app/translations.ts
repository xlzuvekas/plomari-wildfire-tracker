// Spanish and French translations, keyed by the English source string used
// in localize()/translate() calls. English and Greek stay inline in
// app/page.tsx; a missing key here falls back to English at runtime.
// tests/translations.test.ts checks completeness against page.tsx.

export type TranslationMap = Record<string, string>;

export const ES: TranslationMap = {
  // Air quality bands (EEA scale)
  GOOD: "BUENA",
  FAIR: "ACEPTABLE",
  MODERATE: "MODERADA",
  POOR: "MALA",
  "VERY POOR": "MUY MALA",
  "EXTREMELY POOR": "EXTREMADAMENTE MALA",

  // Confidence labels
  OFFICIAL: "OFICIAL",
  OBSERVED: "OBSERVADO",
  "LOCAL REPORT": "INFORME LOCAL",
  MODELED: "MODELIZADO",
  "age unknown": "antigüedad desconocida",
  High: "Alta",
  Nominal: "Nominal",
  Low: "Baja",
  Unknown: "Desconocida",

  // Update categories
  Evacuation: "Evacuación",
  Readiness: "Preparación",
  Road: "Red vial",
  Smoke: "Humo",
  Rekindling: "Reactivación",
  Control: "Control",
  Response: "Intervención",
  Incident: "Incidente",

  // Fire service / incident wire
  "Fire Service": "Cuerpo de Bomberos",
  "STATUS PENDING": "ESTADO PENDIENTE",
  "The official incident board lists the Plomari landfill fire as":
    "El panel oficial de incidentes registra el incendio del vertedero de Plomari como",
  "The board does not provide a perimeter or public route instruction.":
    "El panel no proporciona un perímetro ni instrucciones públicas de ruta.",
  "No archived chronology item is selected by default. Dated archive entries remain available in the list while current sources are checked.":
    "Ningún elemento archivado de la cronología está seleccionado por defecto. Las entradas fechadas del archivo siguen disponibles en la lista mientras se comprueban las fuentes actuales.",
  "Loading FIRMS point feed": "Cargando el flujo de puntos FIRMS",
  "FIRMS point feed unavailable": "Flujo de puntos FIRMS no disponible",
  "latest detecting pass": "última pasada con detecciones",
  "last 6 hours": "últimas 6 horas",
  "last 24 hours": "últimas 24 horas",

  // Place labels
  MELINTA: "MELINTA",
  "PLOMARI BEACH": "PLAYA DE PLOMARI",
  MILIES: "MILIES",
  PLAGIA: "PLAGIA",
  "AGIOS ISIDOROS": "AGIOS ISIDOROS",
  "AGIOS ANTONIOS": "AGIOS ANTONIOS",
  MEGALOCHORI: "MEGALOCHORI",
  PERAMA: "PERAMA",
  PLOMARI: "PLOMARI",

  // Map annotations
  "Restored Chalkelia landfill footprint · not the fire perimeter":
    "Huella del vertedero restaurado de Chalkelia · no es el perímetro del incendio",
  "REPORTED INCIDENT AREA": "ZONA DE INCIDENTE NOTIFICADA",
  "Restored Chalkelia landfill.": "Vertedero restaurado de Chalkelia.",
  "Site location only · perimeter not published.":
    "Solo ubicación del sitio · perímetro no publicado.",
  INCIDENT: "INCIDENTE",
  "16:58 official 112 direction: Plomari beach → Agios Isidoros · historical alert, verify any newer instruction":
    "Instrucción oficial 112 de las 16:58: playa de Plomari → Agios Isidoros · alerta histórica, verifique cualquier instrucción más reciente",
  "112 · 16:58 →": "112 · 16:58 →",
  "nominal 375 m pixel": "píxel nominal de 375 m",
  "SATELLITE THERMAL DETECTION": "DETECCIÓN TÉRMICA SATELITAL",
  "Greece time": "hora de Grecia",
  "Detection confidence": "Confianza de la detección",
  "of incident reference": "de la referencia del incidente",
  "Marker is the pixel center. The halo approximates pixel dimensions, not a fire perimeter. FRP is pixel-integrated radiative power—not flame height or total fire intensity.":
    "El marcador es el centro del píxel. El halo aproxima las dimensiones del píxel, no un perímetro del incendio. La FRP es la potencia radiativa integrada del píxel, no la altura de las llamas ni la intensidad total del fuego.",
  "FIELD-REPORTED AREA (APPROXIMATE)": "ZONA REPORTADA EN CAMPO (APROXIMADA)",
  "Approximate only · not an official perimeter or live flame location.":
    "Solo aproximada · no es un perímetro oficial ni la ubicación en vivo de las llamas.",
  "FIELD REPORT · 20:50": "INFORME DE CAMPO · 20:50",
  "LGMT MEASURED WIND": "VIENTO MEDIDO LGMT",
  gust: "racha",
  "NASA VIIRS daylight aerosol classification · smoke retrieval is coarse, cloud-sensitive and not surface PM2.5":
    "Clasificación diurna de aerosoles NASA VIIRS · la detección de humo es de baja resolución, sensible a nubes y no equivale a PM2.5 en superficie",
  "Higher-confidence centerline of an illustrative wind-driven envelope · terrain and fire behavior are not modeled":
    "Línea central de mayor confianza de una envolvente ilustrativa impulsada por el viento · el terreno y el comportamiento del fuego no están modelizados",
  "Interactive Plomari wildfire operational map":
    "Mapa operativo interactivo del incendio forestal de Plomari",
  "ACQUIRING MAP…": "CARGANDO MAPA…",
  "OFFLINE — DISPLAYING THE LAST AVAILABLE SNAPSHOT":
    "SIN CONEXIÓN — MOSTRANDO LA ÚLTIMA CAPTURA DISPONIBLE",
  "LOCAL INCIDENT PICTURE · MULTISOURCE OSINT":
    "PANORAMA LOCAL DEL INCIDENTE · OSINT MULTIFUENTE",
  "FIRE SERVICE": "CUERPO DE BOMBEROS",
  "GREECE LOCAL": "HORA LOCAL DE GRECIA",
  Language: "Idioma",
  "FIRE BOARD AUTO · 112 MANUAL": "PANEL DE INCENDIOS AUTO · 112 MANUAL",
  "Archived 112 instruction issued at 16:58; not a current verification":
    "Instrucción 112 archivada emitida a las 16:58; no es una verificación actual",
  "ARCHIVED 112 · ISSUED 16:58 · NOT LIVE":
    "112 ARCHIVADO · EMITIDO 16:58 · NO EN VIVO",
  "Archived instruction — not a current verification. Follow newer 112 messages.":
    "Instrucción archivada — no es una verificación actual. Siga los mensajes 112 más recientes.",
  source: "fuente",
  "Official alert": "Alerta oficial",
  "Call 112": "Llame al 112",
  CALL: "LLAMAR",
  "Map style": "Estilo de mapa",
  dark: "oscuro",
  satellite: "satélite",
  terrain: "terreno",
  "Close panel": "Cerrar panel",
  "HIDE LAYERS": "OCULTAR CAPAS",
  LAYERS: "CAPAS",
  "Data layers": "Capas de datos",
  "DATA LAYERS": "CAPAS DE DATOS",
  "8 LAYERS // SOURCE + FRESHNESS VISIBLE":
    "8 CAPAS // FUENTE + ACTUALIDAD VISIBLES",
  FRAME: "ENCUADRE",
  "Close layers": "Cerrar capas",
  "112 evacuation": "Evacuación 112",
  "Original official alert · 16:58": "Alerta oficial original · 16:58",
  "Satellite thermal detections": "Detecciones térmicas satelitales",
  "Daily thermal raster": "Ráster térmico diario",
  "NASA GIBS imagery · not extra points":
    "Imágenes NASA GIBS · sin puntos adicionales",
  "Field-reported areas (approx.)": "Zonas reportadas en campo (aprox.)",
  "1 report · 2 reference areas · 20:50":
    "1 informe · 2 zonas de referencia · 20:50",
  "Wind profile": "Perfil de viento",
  "Satellite aerosol / smoke": "Aerosol / humo satelital",
  "NASA VIIRS NRT · daylight snapshot":
    "NASA VIIRS NRT · captura diurna",
  "Smoke transport proxy": "Modelo indicativo de transporte de humo",
  "Modeled wind envelope · not PM2.5":
    "Envolvente de viento modelizada · no PM2.5",
  "What-if envelope": "Envolvente hipotética",
  "Simulation · never route from this":
    "Simulación · nunca planifique rutas con esto",
  "Satellite thermal detection key": "Leyenda de detección térmica satelital",
  "SATELLITE DETECTION KEY": "LEYENDA DE DETECCIÓN SATELITAL",
  LOADING: "CARGANDO",
  UNAVAILABLE: "NO DISPONIBLE",
  RETRYING: "REINTENTANDO",
  PARTIAL: "PARCIAL",
  AVAILABLE: "DISPONIBLE",
  "Thermal observation window": "Ventana de observación térmica",
  "LATEST DETECTING PASS": "ÚLTIMA PASADA CON DETECCIONES",
  "6 HOURS": "6 HORAS",
  "24 HOURS": "24 HORAS",
  "detection records": "registros de detección",
  Window: "Ventana",
  "latest observation": "última observación",
  "Each marker is the center of a satellite pixel where a thermal anomaly was detected during one overpass. It is not a live flame location, a fire perimeter, or a count of fires.":
    "Cada marcador es el centro de un píxel satelital donde se detectó una anomalía térmica durante una pasada. No es una ubicación en vivo de llamas, ni un perímetro del incendio, ni un recuento de incendios.",
  "FIRMS point feed unavailable — showing no point count. The optional NASA daily raster can be enabled separately.":
    "Flujo de puntos FIRMS no disponible — no se muestra recuento de puntos. El ráster diario opcional de la NASA puede activarse por separado.",
  "No thermal detections were returned for this area in the selected window. This does not mean the fire is out; clouds, satellite timing, and sensor limits can hide activity.":
    "No se devolvieron detecciones térmicas para esta zona en la ventana seleccionada. Esto no significa que el incendio esté extinguido; las nubes, los horarios satelitales y los límites de los sensores pueden ocultar actividad.",
  HIGH: "ALTA",
  "saturated fire pixel": "píxel de fuego saturado",
  NOMINAL: "NOMINAL",
  "strong anomaly; no daytime sun-glint flag":
    "anomalía fuerte; sin indicador diurno de reflejo solar",
  LOW: "BAJA",
  "lower confidence / sun-glint prone":
    "confianza menor / propenso a reflejo solar",
  "Confidence describes detection quality, not fire severity. FRP is pixel-integrated radiative power; not flame height or total fire intensity.":
    "La confianza describe la calidad de la detección, no la gravedad del incendio. La FRP es la potencia radiativa integrada del píxel; no la altura de las llamas ni la intensidad total del fuego.",
  Retrieved: "Obtenido",
  "app checks every 5 min; satellite passes are not continuous":
    "la aplicación comprueba cada 5 min; las pasadas satelitales no son continuas",
  "FIRE-GRID WIND MODEL": "MODELO DE VIENTO EN LA ZONA DEL INCENDIO",
  "SNAPSHOT / RETRYING": "CAPTURA / REINTENTANDO",
  FROM: "DESDE",
  GUST: "RACHA",
  MODEL: "MODELO",
  "FIRE AREA": "ZONA DEL INCENDIO",
  "LGMT MEASURED": "MEDIDO LGMT",
  "Smoke proxy horizon": "Horizonte del modelo de humo",
  min: "min",
  "HIDE UPDATES": "OCULTAR ACTUALIZACIONES",
  UPDATES: "ACTUALIZACIONES",
  "Mobile map navigation": "Navegación móvil del mapa",
  MAP: "MAPA",
  "Incident updates": "Actualizaciones del incidente",
  "INCIDENT WIRE": "CANAL DEL INCIDENTE",
  "GREECE TIME": "HORA DE GRECIA",
  "SNAPSHOT · RETRYING": "CAPTURA · REINTENTANDO",
  REC: "REC",
  "Close updates": "Cerrar actualizaciones",
  "29 JUL 2026": "29 JUL 2026",
  ARCHIVE: "ARCHIVO",
  "ARCHIVE · 29 JUL 2026": "ARCHIVO · 29 JUL 2026",
  ACTION: "ACCIÓN",
  "Direct source": "Fuente directa",
  "SOURCE HEALTH": "ESTADO DE LAS FUENTES",
  reachable: "accesibles",
  failed: "fallidas",
  "optional unconfigured": "opcionales sin configurar",
  CHECKING: "COMPROBANDO",
  "Reachable means the source responded—not that it published a new Plomari update.":
    "Accesible significa que la fuente respondió, no que haya publicado una nueva actualización sobre Plomari.",
  "What-if simulation controls": "Controles de simulación hipotética",
  "SCENARIO ENGINE": "MOTOR DE ESCENARIOS",
  "WHAT-IF ONLY · NOT A FORECAST":
    "SOLO HIPOTÉTICO · NO ES UN PRONÓSTICO",
  Horizon: "Horizonte",
  h: "h",
  Wind: "Viento",
  Heading: "Rumbo",
  "SW · modeled downwind": "SO · a sotavento modelizado",
  "S · Plomari": "S · Plomari",
  "W · Melinta": "O · Melinta",
  "SE · Agios Isidoros": "SE · Agios Isidoros",
  "Illustrative head": "Frente ilustrativo",
  "Current operating picture": "Panorama operativo actual",
  "OFFICIAL STATUS": "ESTADO OFICIAL",
  "Fire Service auto · latest 112 instruction remains manual":
    "Bomberos automático · la última instrucción 112 sigue siendo manual",
  "SATELLITE THERMAL": "TÉRMICO SATELITAL",
  "CHECKING FIRMS": "COMPROBANDO FIRMS",
  "POINT FEED UNAVAILABLE": "FLUJO DE PUNTOS NO DISPONIBLE",
  "No historical points substituted · raster is a separate layer":
    "No se sustituyen puntos históricos · el ráster es una capa aparte",
  "Zero detections is not an all-clear":
    "Cero detecciones no significa fin de la alerta",
  "FIRE-GRID MODEL": "MODELO DE LA ZONA DEL INCENDIO",
  Gust: "Racha",
  "model, not sensor": "modelo, no sensor",
  "POLLING 60 SECONDS": "SONDEO CADA 60 SEGUNDOS",
  "Confidence legend": "Leyenda de confianza",
  REPORTED: "REPORTADO",
  "MODELED / SIM": "MODELIZADO / SIM",
  "NOT AN OFFICIAL EMERGENCY PRODUCT":
    "NO ES UN PRODUCTO OFICIAL DE EMERGENCIA",
  "Interface baseline inspired by": "Interfaz base inspirada en",
  "Authorities override every map layer.":
    "Las autoridades prevalecen sobre cualquier capa del mapa.",

  // Ternary-resolved strings
  "Official alert feed. ": "Canal oficial de alertas. ",
  "Official information feed; only 112 alerts are public protective instructions. ":
    "Canal oficial de información; solo las alertas 112 son instrucciones públicas de protección. ",
  "Publisher feed item; publication time is unavailable, so recency is not verified. ":
    "Elemento del canal del editor; la hora de publicación no está disponible, por lo que la actualidad no está verificada. ",
  "Near-real-time local reporting; not independently confirmed. ":
    "Información local casi en tiempo real; no confirmada de forma independiente. ",
  "Live-source retry in progress":
    "Reintento de conexión con fuentes en vivo en curso",
  "No current live item returned":
    "No se devolvió ningún elemento en vivo actual",
  "Checking live sources": "Comprobando fuentes en vivo",
  "One local report referenced scattered activity near Agios Antonios at 20:50.":
    "Un informe local mencionó actividad dispersa cerca de Agios Antonios a las 20:50.",
  "The same report described activity in the direction of Megalochori; this second area is a broad reference zone.":
    "El mismo informe describió actividad en dirección a Megalochori; esta segunda zona es una zona amplia de referencia.",
  pass: "pasada",
  passes: "pasadas",
  "Checking official and local sources · Greece timestamps":
    "Comprobando fuentes oficiales y locales · horas de Grecia",

  // Static intel timeline (labels + details)
  "Aerial drops ended; scattered hotspots remain":
    "Terminaron las descargas aéreas; quedan focos dispersos",
  "Local field reporting says aerial operations ended for the night, with scattered active hotspots around Agios Antonios and toward Megalochori. Strong winds are hampering ground crews. This is not an official containment statement.":
    "Según información local sobre el terreno, las operaciones aéreas terminaron por la noche, con focos activos dispersos alrededor de Agios Antonios y hacia Megalochori. Los fuertes vientos dificultan el trabajo de los equipos terrestres. No es una declaración oficial de control.",
  "No continuous front reported; rekindling risk":
    "No se reporta frente continuo; riesgo de reactivación",
  "The deputy regional governor reported no active continuous front, but numerous scattered hotspots remained in difficult terrain. Crews stayed alert for rekindling. This was a local official statement, not a Fire Service all-clear.":
    "El vicegobernador regional informó de que no había un frente continuo activo, pero quedaban numerosos focos dispersos en terreno difícil. Los equipos permanecieron alerta ante reactivaciones. Fue una declaración oficial local, no un fin de alerta del Cuerpo de Bomberos.",
  "Hotspots reported near holiday homes":
    "Focos reportados cerca de casas de vacaciones",
  "Local reporting said hotspots remained above Plomari near holiday homes. Residents and volunteers reportedly prevented flames from reaching houses.":
    "La prensa local indicó que quedaban focos por encima de Plomari, cerca de casas de vacaciones. Según los informes, vecinos y voluntarios impidieron que las llamas alcanzaran las viviendas.",
  "Regional satellite smoke observed":
    "Humo regional observado por satélite",
  "Satellite imagery showed smoke from the Plomari incident and a major Turkish fire transported across Lesvos. This is a regional smoke snapshot, not a ground-level PM2.5 measurement.":
    "Las imágenes satelitales mostraron humo del incidente de Plomari y de un gran incendio turco transportado sobre Lesbos. Es una captura regional de humo, no una medición de PM2.5 a nivel del suelo.",
  "Official 112 alert issued at 16:58":
    "Alerta oficial 112 emitida a las 16:58",
  "People in the Plomari area were instructed to move toward Plomari beach in the direction of Agios Isidoros. This reproduces the alert issued at 16:58; check the incident wire and authorities for any newer instruction.":
    "Se indicó a las personas en la zona de Plomari que se dirigieran hacia la playa de Plomari en dirección a Agios Isidoros. Esto reproduce la alerta emitida a las 16:58; consulte el canal del incidente y a las autoridades para cualquier instrucción más reciente.",
  "Fire Service response reinforced":
    "Refuerzo de la respuesta del Cuerpo de Bomberos",
  "Fire Service reported 50 firefighters, two 12th EMODE teams, volunteers, 13 vehicles, three aircraft and three helicopters.":
    "El Cuerpo de Bomberos informó de 50 bomberos, dos equipos del 12.º EMODE, voluntarios, 13 vehículos, tres aviones y tres helicópteros.",
  "Latest satellite heat": "Último calor satelital",
  "Aqua MODIS detected active heat near Chalkelia. A satellite point is an observed hot pixel, not a fire perimeter.":
    "Aqua MODIS detectó calor activo cerca de Chalkelia. Un punto satelital es un píxel caliente observado, no un perímetro del incendio.",
  "NOAA-20 pass": "Pasada de NOAA-20",
  "Six VIIRS hot pixels were detected near the incident, including three high-confidence detections.":
    "Se detectaron seis píxeles calientes VIIRS cerca del incidente, incluidas tres detecciones de alta confianza.",
  "Fire reported": "Incendio reportado",
  "The incident was reported around the restored Chalkelia landfill, north-east of Plomari.":
    "El incidente se reportó en torno al vertedero restaurado de Chalkelia, al noreste de Plomari.",

  // Sources list (labels + kinds)
  "Fire Service board": "Panel del Cuerpo de Bomberos",
  "Official incident status · automatic":
    "Estado oficial del incidente · automático",
  "112 Greece": "112 Grecia",
  "Protective guidance": "Guía de protección",
  "Official safety instructions": "Instrucciones oficiales de seguridad",
  "Official response · 16:34": "Respuesta oficial · 16:34",
  "StoNisi overnight": "StoNisi durante la noche",
  "Local field report · 20:50": "Informe local de campo · 20:50",
  Aeolos: "Aeolos",
  "Local reporting · repeated rekindling":
    "Prensa local · reactivaciones repetidas",
  "Satellite smoke": "Humo satelital",
  "Regional smoke report · 17:50": "Informe regional de humo · 17:50",
  "NASA FIRMS": "NASA FIRMS",
  "Thermal points · server-side API": "Puntos térmicos · API del servidor",
  "NASA GIBS": "NASA GIBS",
  "No-key thermal / aerosol overlay":
    "Capa térmica / de aerosoles sin clave",
  "Open-Meteo": "Open-Meteo",
  "Detailed point wind model": "Modelo puntual detallado de viento",
  AviationWeather: "AviationWeather",
  "Measured LGMT airport METAR": "METAR medido del aeropuerto LGMT",

  // Live feed summaries (from the updates API)
  "Item from an official source. Open the direct source for the full statement and any instructions.":
    "Elemento de una fuente oficial. Abra la fuente directa para ver la declaración completa y cualquier instrucción.",
  "Headline link from the publisher; open the direct source for the full report.":
    "Enlace de titular del editor; abra la fuente directa para ver el reportaje completo.",
  "Live local-reporting page; open the direct source for the full chronology and field details.":
    "Página local de información en vivo; abra la fuente directa para ver la cronología completa y los detalles de campo.",
  "Direct post from an official account. Follow the linked instruction and authorities on the ground.":
    "Publicación directa de una cuenta oficial. Siga la instrucción enlazada y a las autoridades sobre el terreno.",
};

export const FR: TranslationMap = {
  // Air quality bands (EEA scale)
  GOOD: "BONNE",
  FAIR: "CORRECTE",
  MODERATE: "MOYENNE",
  POOR: "MAUVAISE",
  "VERY POOR": "TRÈS MAUVAISE",
  "EXTREMELY POOR": "EXTRÊMEMENT MAUVAISE",

  // Confidence labels
  OFFICIAL: "OFFICIEL",
  OBSERVED: "OBSERVÉ",
  "LOCAL REPORT": "RAPPORT LOCAL",
  MODELED: "MODÉLISÉ",
  "age unknown": "ancienneté inconnue",
  High: "Élevée",
  Nominal: "Nominale",
  Low: "Faible",
  Unknown: "Inconnue",

  // Update categories
  Evacuation: "Évacuation",
  Readiness: "Vigilance",
  Road: "Réseau routier",
  Smoke: "Fumée",
  Rekindling: "Reprise de feu",
  Control: "Maîtrise",
  Response: "Intervention",
  Incident: "Incident",

  // Fire service / incident wire
  "Fire Service": "Service des pompiers",
  "STATUS PENDING": "STATUT EN ATTENTE",
  "The official incident board lists the Plomari landfill fire as":
    "Le tableau officiel des incidents classe l'incendie de la décharge de Plomari comme",
  "The board does not provide a perimeter or public route instruction.":
    "Le tableau ne fournit ni périmètre ni consigne publique d'itinéraire.",
  "No archived chronology item is selected by default. Dated archive entries remain available in the list while current sources are checked.":
    "Aucun élément archivé de la chronologie n'est sélectionné par défaut. Les entrées datées de l'archive restent disponibles dans la liste pendant la vérification des sources actuelles.",
  "Loading FIRMS point feed": "Chargement du flux de points FIRMS",
  "FIRMS point feed unavailable": "Flux de points FIRMS indisponible",
  "latest detecting pass": "dernier passage avec détections",
  "last 6 hours": "6 dernières heures",
  "last 24 hours": "24 dernières heures",

  // Place labels
  MELINTA: "MELINTA",
  "PLOMARI BEACH": "PLAGE DE PLOMARI",
  MILIES: "MILIES",
  PLAGIA: "PLAGIA",
  "AGIOS ISIDOROS": "AGIOS ISIDOROS",
  "AGIOS ANTONIOS": "AGIOS ANTONIOS",
  MEGALOCHORI: "MEGALOCHORI",
  PERAMA: "PERAMA",
  PLOMARI: "PLOMARI",

  // Map annotations
  "Restored Chalkelia landfill footprint · not the fire perimeter":
    "Emprise de la décharge réhabilitée de Chalkelia · pas le périmètre de l'incendie",
  "REPORTED INCIDENT AREA": "ZONE D'INCIDENT SIGNALÉE",
  "Restored Chalkelia landfill.": "Décharge réhabilitée de Chalkelia.",
  "Site location only · perimeter not published.":
    "Emplacement du site uniquement · périmètre non publié.",
  INCIDENT: "INCIDENT",
  "16:58 official 112 direction: Plomari beach → Agios Isidoros · historical alert, verify any newer instruction":
    "Consigne officielle 112 de 16h58 : plage de Plomari → Agios Isidoros · alerte historique, vérifiez toute consigne plus récente",
  "112 · 16:58 →": "112 · 16h58 →",
  "nominal 375 m pixel": "pixel nominal de 375 m",
  "SATELLITE THERMAL DETECTION": "DÉTECTION THERMIQUE SATELLITE",
  "Greece time": "heure de Grèce",
  "Detection confidence": "Confiance de la détection",
  "of incident reference": "de la référence de l'incident",
  "Marker is the pixel center. The halo approximates pixel dimensions, not a fire perimeter. FRP is pixel-integrated radiative power—not flame height or total fire intensity.":
    "Le marqueur est le centre du pixel. Le halo approxime les dimensions du pixel, pas un périmètre d'incendie. La FRP est la puissance radiative intégrée du pixel — ni la hauteur des flammes ni l'intensité totale du feu.",
  "FIELD-REPORTED AREA (APPROXIMATE)": "ZONE SIGNALÉE SUR LE TERRAIN (APPROXIMATIVE)",
  "Approximate only · not an official perimeter or live flame location.":
    "Approximatif uniquement · ni périmètre officiel ni position en direct des flammes.",
  "FIELD REPORT · 20:50": "RAPPORT DE TERRAIN · 20h50",
  "LGMT MEASURED WIND": "VENT MESURÉ LGMT",
  gust: "rafale",
  "NASA VIIRS daylight aerosol classification · smoke retrieval is coarse, cloud-sensitive and not surface PM2.5":
    "Classification diurne des aérosols NASA VIIRS · la détection de fumée est grossière, sensible aux nuages et ne correspond pas aux PM2,5 en surface",
  "Higher-confidence centerline of an illustrative wind-driven envelope · terrain and fire behavior are not modeled":
    "Ligne centrale à confiance plus élevée d'une enveloppe illustrative portée par le vent · le terrain et le comportement du feu ne sont pas modélisés",
  "Interactive Plomari wildfire operational map":
    "Carte opérationnelle interactive de l'incendie de Plomari",
  "ACQUIRING MAP…": "CHARGEMENT DE LA CARTE…",
  "OFFLINE — DISPLAYING THE LAST AVAILABLE SNAPSHOT":
    "HORS LIGNE — AFFICHAGE DU DERNIER INSTANTANÉ DISPONIBLE",
  "LOCAL INCIDENT PICTURE · MULTISOURCE OSINT":
    "TABLEAU LOCAL DE L'INCIDENT · OSINT MULTISOURCE",
  "FIRE SERVICE": "SERVICE DES POMPIERS",
  "GREECE LOCAL": "HEURE LOCALE DE GRÈCE",
  Language: "Langue",
  "FIRE BOARD AUTO · 112 MANUAL": "TABLEAU INCENDIE AUTO · 112 MANUEL",
  "Archived 112 instruction issued at 16:58; not a current verification":
    "Consigne 112 archivée émise à 16h58 ; pas une vérification actuelle",
  "ARCHIVED 112 · ISSUED 16:58 · NOT LIVE":
    "112 ARCHIVÉ · ÉMIS 16h58 · PAS EN DIRECT",
  "Archived instruction — not a current verification. Follow newer 112 messages.":
    "Consigne archivée — pas une vérification actuelle. Suivez les messages 112 plus récents.",
  source: "source",
  "Official alert": "Alerte officielle",
  "Call 112": "Appelez le 112",
  CALL: "APPELER",
  "Map style": "Style de carte",
  dark: "sombre",
  satellite: "satellite",
  terrain: "terrain",
  "Close panel": "Fermer le panneau",
  "HIDE LAYERS": "MASQUER LES COUCHES",
  LAYERS: "COUCHES",
  "Data layers": "Couches de données",
  "DATA LAYERS": "COUCHES DE DONNÉES",
  "8 LAYERS // SOURCE + FRESHNESS VISIBLE":
    "8 COUCHES // SOURCE + FRAÎCHEUR VISIBLES",
  FRAME: "CADRAGE",
  "Close layers": "Fermer les couches",
  "112 evacuation": "Évacuation 112",
  "Original official alert · 16:58": "Alerte officielle initiale · 16h58",
  "Satellite thermal detections": "Détections thermiques satellite",
  "Daily thermal raster": "Raster thermique quotidien",
  "NASA GIBS imagery · not extra points":
    "Imagerie NASA GIBS · pas de points supplémentaires",
  "Field-reported areas (approx.)": "Zones signalées sur le terrain (approx.)",
  "1 report · 2 reference areas · 20:50":
    "1 rapport · 2 zones de référence · 20h50",
  "Wind profile": "Profil de vent",
  "Satellite aerosol / smoke": "Aérosols / fumée satellite",
  "NASA VIIRS NRT · daylight snapshot":
    "NASA VIIRS NRT · instantané diurne",
  "Smoke transport proxy": "Modèle indicatif de transport de fumée",
  "Modeled wind envelope · not PM2.5":
    "Enveloppe de vent modélisée · pas des PM2,5",
  "What-if envelope": "Enveloppe hypothétique",
  "Simulation · never route from this":
    "Simulation · ne planifiez jamais d'itinéraire avec ceci",
  "Satellite thermal detection key": "Légende de détection thermique satellite",
  "SATELLITE DETECTION KEY": "LÉGENDE DE DÉTECTION SATELLITE",
  LOADING: "CHARGEMENT",
  UNAVAILABLE: "INDISPONIBLE",
  RETRYING: "NOUVELLE TENTATIVE",
  PARTIAL: "PARTIEL",
  AVAILABLE: "DISPONIBLE",
  "Thermal observation window": "Fenêtre d'observation thermique",
  "LATEST DETECTING PASS": "DERNIER PASSAGE AVEC DÉTECTIONS",
  "6 HOURS": "6 HEURES",
  "24 HOURS": "24 HEURES",
  "detection records": "enregistrements de détection",
  Window: "Fenêtre",
  "latest observation": "dernière observation",
  "Each marker is the center of a satellite pixel where a thermal anomaly was detected during one overpass. It is not a live flame location, a fire perimeter, or a count of fires.":
    "Chaque marqueur est le centre d'un pixel satellite où une anomalie thermique a été détectée lors d'un passage. Ce n'est ni une position en direct des flammes, ni un périmètre d'incendie, ni un décompte d'incendies.",
  "FIRMS point feed unavailable — showing no point count. The optional NASA daily raster can be enabled separately.":
    "Flux de points FIRMS indisponible — aucun décompte de points affiché. Le raster quotidien optionnel de la NASA peut être activé séparément.",
  "No thermal detections were returned for this area in the selected window. This does not mean the fire is out; clouds, satellite timing, and sensor limits can hide activity.":
    "Aucune détection thermique n'a été renvoyée pour cette zone dans la fenêtre sélectionnée. Cela ne signifie pas que l'incendie est éteint ; les nuages, les horaires des satellites et les limites des capteurs peuvent masquer l'activité.",
  HIGH: "ÉLEVÉE",
  "saturated fire pixel": "pixel de feu saturé",
  NOMINAL: "NOMINALE",
  "strong anomaly; no daytime sun-glint flag":
    "anomalie forte ; pas d'indicateur diurne de reflet solaire",
  LOW: "FAIBLE",
  "lower confidence / sun-glint prone":
    "confiance plus faible / sujet aux reflets solaires",
  "Confidence describes detection quality, not fire severity. FRP is pixel-integrated radiative power; not flame height or total fire intensity.":
    "La confiance décrit la qualité de la détection, pas la gravité de l'incendie. La FRP est la puissance radiative intégrée du pixel ; ni la hauteur des flammes ni l'intensité totale du feu.",
  Retrieved: "Récupéré",
  "app checks every 5 min; satellite passes are not continuous":
    "l'application vérifie toutes les 5 min ; les passages satellites ne sont pas continus",
  "FIRE-GRID WIND MODEL": "MODÈLE DE VENT DE LA ZONE D'INCENDIE",
  "SNAPSHOT / RETRYING": "INSTANTANÉ / NOUVELLE TENTATIVE",
  FROM: "DEPUIS",
  GUST: "RAFALE",
  MODEL: "MODÈLE",
  "FIRE AREA": "ZONE D'INCENDIE",
  "LGMT MEASURED": "MESURÉ LGMT",
  "Smoke proxy horizon": "Horizon du modèle de fumée",
  min: "min",
  "HIDE UPDATES": "MASQUER LES MISES À JOUR",
  UPDATES: "MISES À JOUR",
  "Mobile map navigation": "Navigation mobile de la carte",
  MAP: "CARTE",
  "Incident updates": "Mises à jour de l'incident",
  "INCIDENT WIRE": "FIL DE L'INCIDENT",
  "GREECE TIME": "HEURE DE GRÈCE",
  "SNAPSHOT · RETRYING": "INSTANTANÉ · NOUVELLE TENTATIVE",
  REC: "REC",
  "Close updates": "Fermer les mises à jour",
  "29 JUL 2026": "29 JUIL 2026",
  ARCHIVE: "ARCHIVE",
  "ARCHIVE · 29 JUL 2026": "ARCHIVE · 29 JUIL 2026",
  ACTION: "ACTION",
  "Direct source": "Source directe",
  "SOURCE HEALTH": "ÉTAT DES SOURCES",
  reachable: "joignables",
  failed: "en échec",
  "optional unconfigured": "optionnelles non configurées",
  CHECKING: "VÉRIFICATION",
  "Reachable means the source responded—not that it published a new Plomari update.":
    "Joignable signifie que la source a répondu — pas qu'elle a publié une nouvelle mise à jour sur Plomari.",
  "What-if simulation controls": "Commandes de simulation hypothétique",
  "SCENARIO ENGINE": "MOTEUR DE SCÉNARIOS",
  "WHAT-IF ONLY · NOT A FORECAST":
    "HYPOTHÈSE UNIQUEMENT · PAS UNE PRÉVISION",
  Horizon: "Horizon",
  h: "h",
  Wind: "Vent",
  Heading: "Cap",
  "SW · modeled downwind": "SO · sous le vent modélisé",
  "S · Plomari": "S · Plomari",
  "W · Melinta": "O · Melinta",
  "SE · Agios Isidoros": "SE · Agios Isidoros",
  "Illustrative head": "Front illustratif",
  "Current operating picture": "Tableau opérationnel actuel",
  "OFFICIAL STATUS": "STATUT OFFICIEL",
  "Fire Service auto · latest 112 instruction remains manual":
    "Pompiers automatique · la dernière consigne 112 reste manuelle",
  "SATELLITE THERMAL": "THERMIQUE SATELLITE",
  "CHECKING FIRMS": "VÉRIFICATION FIRMS",
  "POINT FEED UNAVAILABLE": "FLUX DE POINTS INDISPONIBLE",
  "No historical points substituted · raster is a separate layer":
    "Aucun point historique substitué · le raster est une couche distincte",
  "Zero detections is not an all-clear":
    "Zéro détection ne vaut pas fin d'alerte",
  "FIRE-GRID MODEL": "MODÈLE DE LA ZONE D'INCENDIE",
  Gust: "Rafale",
  "model, not sensor": "modèle, pas capteur",
  "POLLING 60 SECONDS": "SONDAGE TOUTES LES 60 SECONDES",
  "Confidence legend": "Légende de confiance",
  REPORTED: "SIGNALÉ",
  "MODELED / SIM": "MODÉLISÉ / SIM",
  "NOT AN OFFICIAL EMERGENCY PRODUCT":
    "PAS UN PRODUIT OFFICIEL D'URGENCE",
  "Interface baseline inspired by": "Interface de base inspirée de",
  "Authorities override every map layer.":
    "Les autorités priment sur toutes les couches de la carte.",

  // Ternary-resolved strings
  "Official alert feed. ": "Flux officiel d'alertes. ",
  "Official information feed; only 112 alerts are public protective instructions. ":
    "Flux officiel d'information ; seules les alertes 112 sont des consignes publiques de protection. ",
  "Publisher feed item; publication time is unavailable, so recency is not verified. ":
    "Élément du flux de l'éditeur ; l'heure de publication n'est pas disponible, la fraîcheur n'est donc pas vérifiée. ",
  "Near-real-time local reporting; not independently confirmed. ":
    "Information locale quasi en temps réel ; non confirmée de manière indépendante. ",
  "Live-source retry in progress":
    "Nouvelle tentative de connexion aux sources en direct",
  "No current live item returned":
    "Aucun élément en direct actuel renvoyé",
  "Checking live sources": "Vérification des sources en direct",
  "One local report referenced scattered activity near Agios Antonios at 20:50.":
    "Un rapport local a mentionné une activité dispersée près d'Agios Antonios à 20h50.",
  "The same report described activity in the direction of Megalochori; this second area is a broad reference zone.":
    "Le même rapport a décrit une activité en direction de Megalochori ; cette seconde zone est une large zone de référence.",
  pass: "passage",
  passes: "passages",
  "Checking official and local sources · Greece timestamps":
    "Vérification des sources officielles et locales · heures de Grèce",

  // Static intel timeline (labels + details)
  "Aerial drops ended; scattered hotspots remain":
    "Fin des largages aériens ; des foyers dispersés subsistent",
  "Local field reporting says aerial operations ended for the night, with scattered active hotspots around Agios Antonios and toward Megalochori. Strong winds are hampering ground crews. This is not an official containment statement.":
    "Selon des informations locales de terrain, les opérations aériennes ont cessé pour la nuit, avec des foyers actifs dispersés autour d'Agios Antonios et vers Megalochori. Des vents forts gênent les équipes au sol. Ce n'est pas une déclaration officielle de maîtrise.",
  "No continuous front reported; rekindling risk":
    "Aucun front continu signalé ; risque de reprise de feu",
  "The deputy regional governor reported no active continuous front, but numerous scattered hotspots remained in difficult terrain. Crews stayed alert for rekindling. This was a local official statement, not a Fire Service all-clear.":
    "Le vice-gouverneur régional a indiqué qu'il n'y avait pas de front continu actif, mais de nombreux foyers dispersés subsistaient en terrain difficile. Les équipes sont restées vigilantes face aux reprises de feu. C'était une déclaration officielle locale, pas une fin d'alerte du service des pompiers.",
  "Hotspots reported near holiday homes":
    "Foyers signalés près de résidences de vacances",
  "Local reporting said hotspots remained above Plomari near holiday homes. Residents and volunteers reportedly prevented flames from reaching houses.":
    "La presse locale a indiqué que des foyers subsistaient au-dessus de Plomari, près de résidences de vacances. Des habitants et des bénévoles auraient empêché les flammes d'atteindre les maisons.",
  "Regional satellite smoke observed":
    "Fumée régionale observée par satellite",
  "Satellite imagery showed smoke from the Plomari incident and a major Turkish fire transported across Lesvos. This is a regional smoke snapshot, not a ground-level PM2.5 measurement.":
    "L'imagerie satellite a montré de la fumée provenant de l'incident de Plomari et d'un grand incendie turc transportée au-dessus de Lesbos. C'est un instantané régional de fumée, pas une mesure des PM2,5 au sol.",
  "Official 112 alert issued at 16:58":
    "Alerte officielle 112 émise à 16h58",
  "People in the Plomari area were instructed to move toward Plomari beach in the direction of Agios Isidoros. This reproduces the alert issued at 16:58; check the incident wire and authorities for any newer instruction.":
    "Les personnes dans la zone de Plomari ont reçu pour consigne de se diriger vers la plage de Plomari en direction d'Agios Isidoros. Ceci reproduit l'alerte émise à 16h58 ; consultez le fil de l'incident et les autorités pour toute consigne plus récente.",
  "Fire Service response reinforced":
    "Renforcement de la réponse des pompiers",
  "Fire Service reported 50 firefighters, two 12th EMODE teams, volunteers, 13 vehicles, three aircraft and three helicopters.":
    "Le service des pompiers a fait état de 50 pompiers, deux équipes du 12e EMODE, des bénévoles, 13 véhicules, trois avions et trois hélicoptères.",
  "Latest satellite heat": "Dernière chaleur satellite",
  "Aqua MODIS detected active heat near Chalkelia. A satellite point is an observed hot pixel, not a fire perimeter.":
    "Aqua MODIS a détecté une chaleur active près de Chalkelia. Un point satellite est un pixel chaud observé, pas un périmètre d'incendie.",
  "NOAA-20 pass": "Passage de NOAA-20",
  "Six VIIRS hot pixels were detected near the incident, including three high-confidence detections.":
    "Six pixels chauds VIIRS ont été détectés près de l'incident, dont trois détections à haute confiance.",
  "Fire reported": "Incendie signalé",
  "The incident was reported around the restored Chalkelia landfill, north-east of Plomari.":
    "L'incident a été signalé autour de la décharge réhabilitée de Chalkelia, au nord-est de Plomari.",

  // Sources list (labels + kinds)
  "Fire Service board": "Tableau du service des pompiers",
  "Official incident status · automatic":
    "Statut officiel de l'incident · automatique",
  "112 Greece": "112 Grèce",
  "Protective guidance": "Consignes de protection",
  "Official safety instructions": "Consignes officielles de sécurité",
  "Official response · 16:34": "Réponse officielle · 16h34",
  "StoNisi overnight": "StoNisi pendant la nuit",
  "Local field report · 20:50": "Rapport local de terrain · 20h50",
  Aeolos: "Aeolos",
  "Local reporting · repeated rekindling":
    "Presse locale · reprises de feu répétées",
  "Satellite smoke": "Fumée satellite",
  "Regional smoke report · 17:50": "Rapport régional de fumée · 17h50",
  "NASA FIRMS": "NASA FIRMS",
  "Thermal points · server-side API": "Points thermiques · API côté serveur",
  "NASA GIBS": "NASA GIBS",
  "No-key thermal / aerosol overlay":
    "Couche thermique / aérosols sans clé",
  "Open-Meteo": "Open-Meteo",
  "Detailed point wind model": "Modèle de vent ponctuel détaillé",
  AviationWeather: "AviationWeather",
  "Measured LGMT airport METAR": "METAR mesuré de l'aéroport LGMT",

  // Live feed summaries (from the updates API)
  "Item from an official source. Open the direct source for the full statement and any instructions.":
    "Élément d'une source officielle. Ouvrez la source directe pour la déclaration complète et les éventuelles consignes.",
  "Headline link from the publisher; open the direct source for the full report.":
    "Lien de titre de l'éditeur ; ouvrez la source directe pour le reportage complet.",
  "Live local-reporting page; open the direct source for the full chronology and field details.":
    "Page locale d'information en direct ; ouvrez la source directe pour la chronologie complète et les détails de terrain.",
  "Direct post from an official account. Follow the linked instruction and authorities on the ground.":
    "Publication directe d'un compte officiel. Suivez la consigne liée et les autorités sur le terrain.",
};
