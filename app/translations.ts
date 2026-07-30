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

export const DE: TranslationMap = {
  // Air quality bands (EEA scale)
  GOOD: "GUT",
  FAIR: "BEFRIEDIGEND",
  MODERATE: "MÄSSIG",
  POOR: "SCHLECHT",
  "VERY POOR": "SEHR SCHLECHT",
  "EXTREMELY POOR": "EXTREM SCHLECHT",

  // Confidence labels
  OFFICIAL: "OFFIZIELL",
  OBSERVED: "BEOBACHTET",
  "LOCAL REPORT": "LOKALER BERICHT",
  MODELED: "MODELLIERT",
  "age unknown": "Alter unbekannt",
  High: "Hoch",
  Nominal: "Nominal",
  Low: "Niedrig",
  Unknown: "Unbekannt",

  // Update categories
  Evacuation: "Evakuierung",
  Readiness: "Bereitschaft",
  Road: "Straßennetz",
  Smoke: "Rauch",
  Rekindling: "Wiederaufflammen",
  Control: "Kontrolle",
  Response: "Einsatz",
  Incident: "Ereignis",

  // Fire service / incident wire
  "Fire Service": "Feuerwehr",
  "STATUS PENDING": "STATUS AUSSTEHEND",
  "The official incident board lists the Plomari landfill fire as":
    "Die offizielle Einsatztafel führt den Deponiebrand von Plomari als",
  "The board does not provide a perimeter or public route instruction.":
    "Die Tafel liefert weder einen Perimeter noch öffentliche Routenanweisungen.",
  "No archived chronology item is selected by default. Dated archive entries remain available in the list while current sources are checked.":
    "Standardmäßig ist kein archivierter Chronikeintrag ausgewählt. Datierte Archiveinträge bleiben in der Liste verfügbar, während aktuelle Quellen geprüft werden.",
  "Loading FIRMS point feed": "FIRMS-Punktfeed wird geladen",
  "FIRMS point feed unavailable": "FIRMS-Punktfeed nicht verfügbar",
  "latest detecting pass": "letzter Überflug mit Detektionen",
  "last 6 hours": "letzte 6 Stunden",
  "last 24 hours": "letzte 24 Stunden",

  // Place labels
  MELINTA: "MELINTA",
  "PLOMARI BEACH": "STRAND VON PLOMARI",
  MILIES: "MILIES",
  PLAGIA: "PLAGIA",
  "AGIOS ISIDOROS": "AGIOS ISIDOROS",
  "AGIOS ANTONIOS": "AGIOS ANTONIOS",
  MEGALOCHORI: "MEGALOCHORI",
  PERAMA: "PERAMA",
  PLOMARI: "PLOMARI",

  // Map annotations
  "Restored Chalkelia landfill footprint · not the fire perimeter":
    "Fläche der sanierten Deponie Chalkelia · nicht der Brandperimeter",
  "REPORTED INCIDENT AREA": "GEMELDETES EREIGNISGEBIET",
  "Restored Chalkelia landfill.": "Sanierte Deponie Chalkelia.",
  "Site location only · perimeter not published.":
    "Nur Standort · Perimeter nicht veröffentlicht.",
  INCIDENT: "EREIGNIS",
  "16:58 official 112 direction: Plomari beach → Agios Isidoros · historical alert, verify any newer instruction":
    "Offizielle 112-Anweisung von 16:58: Strand von Plomari → Agios Isidoros · historische Warnung, neuere Anweisungen prüfen",
  "112 · 16:58 →": "112 · 16:58 →",
  "nominal 375 m pixel": "nominales 375-m-Pixel",
  "SATELLITE THERMAL DETECTION": "THERMISCHE SATELLITENDETEKTION",
  "Greece time": "griechische Zeit",
  "Detection confidence": "Detektionskonfidenz",
  "of incident reference": "vom Ereignisreferenzpunkt",
  "Marker is the pixel center. The halo approximates pixel dimensions, not a fire perimeter. FRP is pixel-integrated radiative power—not flame height or total fire intensity.":
    "Der Marker ist das Pixelzentrum. Der Halo nähert die Pixelmaße an, nicht einen Brandperimeter. FRP ist die pixelintegrierte Strahlungsleistung — weder Flammenhöhe noch Gesamtintensität des Feuers.",
  "FIELD-REPORTED AREA (APPROXIMATE)": "VOR ORT GEMELDETES GEBIET (UNGEFÄHR)",
  "Approximate only · not an official perimeter or live flame location.":
    "Nur ungefähr · kein offizieller Perimeter und keine Live-Flammenposition.",
  "FIELD REPORT · 20:50": "FELDBERICHT · 20:50",
  "LGMT MEASURED WIND": "LGMT GEMESSENER WIND",
  gust: "Böe",
  "NASA VIIRS daylight aerosol classification · smoke retrieval is coarse, cloud-sensitive and not surface PM2.5":
    "NASA-VIIRS-Aerosolklassifikation bei Tageslicht · Raucherkennung ist grob, wolkenempfindlich und keine PM2,5-Bodenmessung",
  "Higher-confidence centerline of an illustrative wind-driven envelope · terrain and fire behavior are not modeled":
    "Mittellinie höherer Konfidenz einer illustrativen windgetriebenen Hüllkurve · Gelände und Feuerverhalten sind nicht modelliert",
  "Interactive Plomari wildfire operational map":
    "Interaktive Einsatzkarte des Waldbrands von Plomari",
  "ACQUIRING MAP…": "KARTE WIRD GELADEN…",
  "OFFLINE — DISPLAYING THE LAST AVAILABLE SNAPSHOT":
    "OFFLINE — LETZTER VERFÜGBARER SNAPSHOT WIRD ANGEZEIGT",
  "LOCAL INCIDENT PICTURE · MULTISOURCE OSINT":
    "LOKALES LAGEBILD · OSINT AUS MEHREREN QUELLEN",
  "FIRE SERVICE": "FEUERWEHR",
  "GREECE LOCAL": "ORTSZEIT GRIECHENLAND",
  Language: "Sprache",
  "FIRE BOARD AUTO · 112 MANUAL": "BRANDTAFEL AUTO · 112 MANUELL",
  "Archived 112 instruction issued at 16:58; not a current verification":
    "Archivierte 112-Anweisung von 16:58; keine aktuelle Verifizierung",
  "ARCHIVED 112 · ISSUED 16:58 · NOT LIVE":
    "112 ARCHIVIERT · AUSGEGEBEN 16:58 · NICHT LIVE",
  "Archived instruction — not a current verification. Follow newer 112 messages.":
    "Archivierte Anweisung — keine aktuelle Verifizierung. Neuere 112-Meldungen befolgen.",
  source: "Quelle",
  "Official alert": "Offizielle Warnung",
  "Call 112": "112 anrufen",
  CALL: "ANRUFEN",
  "Map style": "Kartenstil",
  dark: "dunkel",
  satellite: "Satellit",
  terrain: "Gelände",
  "Close panel": "Panel schließen",
  "HIDE LAYERS": "EBENEN AUSBLENDEN",
  LAYERS: "EBENEN",
  "Data layers": "Datenebenen",
  "DATA LAYERS": "DATENEBENEN",
  "8 LAYERS // SOURCE + FRESHNESS VISIBLE":
    "8 EBENEN // QUELLE + AKTUALITÄT SICHTBAR",
  FRAME: "AUSRICHTEN",
  "Close layers": "Ebenen schließen",
  "112 evacuation": "112-Evakuierung",
  "Original official alert · 16:58": "Ursprüngliche offizielle Warnung · 16:58",
  "Satellite thermal detections": "Thermische Satellitendetektionen",
  "Daily thermal raster": "Tägliches Thermalraster",
  "NASA GIBS imagery · not extra points":
    "NASA-GIBS-Bilder · keine zusätzlichen Punkte",
  "Field-reported areas (approx.)": "Vor Ort gemeldete Gebiete (ca.)",
  "1 report · 2 reference areas · 20:50":
    "1 Bericht · 2 Referenzgebiete · 20:50",
  "Wind profile": "Windprofil",
  "Satellite aerosol / smoke": "Satellitenaerosol / Rauch",
  "NASA VIIRS NRT · daylight snapshot":
    "NASA VIIRS NRT · Tageslicht-Snapshot",
  "Smoke transport proxy": "Indikatives Rauchtransportmodell",
  "Modeled wind envelope · not PM2.5":
    "Modellierte Windhüllkurve · kein PM2,5",
  "What-if envelope": "Was-wäre-wenn-Hüllkurve",
  "Simulation · never route from this":
    "Simulation · niemals Routen daraus ableiten",
  "Satellite thermal detection key": "Legende thermischer Satellitendetektion",
  "SATELLITE DETECTION KEY": "SATELLITENDETEKTIONS-LEGENDE",
  LOADING: "LÄDT",
  UNAVAILABLE: "NICHT VERFÜGBAR",
  RETRYING: "NEUER VERSUCH",
  PARTIAL: "TEILWEISE",
  AVAILABLE: "VERFÜGBAR",
  "Thermal observation window": "Thermisches Beobachtungsfenster",
  "LATEST DETECTING PASS": "LETZTER ÜBERFLUG MIT DETEKTIONEN",
  "6 HOURS": "6 STUNDEN",
  "24 HOURS": "24 STUNDEN",
  "detection records": "Detektionsdatensätze",
  Window: "Fenster",
  "latest observation": "letzte Beobachtung",
  "Each marker is the center of a satellite pixel where a thermal anomaly was detected during one overpass. It is not a live flame location, a fire perimeter, or a count of fires.":
    "Jeder Marker ist das Zentrum eines Satellitenpixels, in dem während eines Überflugs eine thermische Anomalie erkannt wurde. Er ist weder eine Live-Flammenposition noch ein Brandperimeter noch eine Anzahl von Bränden.",
  "FIRMS point feed unavailable — showing no point count. The optional NASA daily raster can be enabled separately.":
    "FIRMS-Punktfeed nicht verfügbar — keine Punktanzahl wird angezeigt. Das optionale tägliche NASA-Raster kann separat aktiviert werden.",
  "No thermal detections were returned for this area in the selected window. This does not mean the fire is out; clouds, satellite timing, and sensor limits can hide activity.":
    "Für dieses Gebiet wurden im gewählten Fenster keine thermischen Detektionen zurückgegeben. Das bedeutet nicht, dass das Feuer gelöscht ist; Wolken, Satellitenzeitpunkte und Sensorgrenzen können Aktivität verbergen.",
  HIGH: "HOCH",
  "saturated fire pixel": "gesättigtes Feuerpixel",
  NOMINAL: "NOMINAL",
  "strong anomaly; no daytime sun-glint flag":
    "starke Anomalie; kein Sonnenreflex-Flag bei Tageslicht",
  LOW: "NIEDRIG",
  "lower confidence / sun-glint prone":
    "geringere Konfidenz / anfällig für Sonnenreflexe",
  "Confidence describes detection quality, not fire severity. FRP is pixel-integrated radiative power; not flame height or total fire intensity.":
    "Die Konfidenz beschreibt die Detektionsqualität, nicht die Brandschwere. FRP ist die pixelintegrierte Strahlungsleistung; weder Flammenhöhe noch Gesamtintensität des Feuers.",
  Retrieved: "Abgerufen",
  "app checks every 5 min; satellite passes are not continuous":
    "App prüft alle 5 Min.; Satellitenüberflüge sind nicht kontinuierlich",
  "FIRE-GRID WIND MODEL": "WINDMODELL BRANDGEBIET",
  "SNAPSHOT / RETRYING": "SNAPSHOT / NEUER VERSUCH",
  FROM: "AUS",
  GUST: "BÖE",
  MODEL: "MODELL",
  "FIRE AREA": "BRANDGEBIET",
  "LGMT MEASURED": "LGMT GEMESSEN",
  "Smoke proxy horizon": "Horizont des Rauchmodells",
  min: "Min.",
  "HIDE UPDATES": "UPDATES AUSBLENDEN",
  UPDATES: "UPDATES",
  "Mobile map navigation": "Mobile Kartennavigation",
  MAP: "KARTE",
  "Incident updates": "Ereignis-Updates",
  "INCIDENT WIRE": "EREIGNIS-TICKER",
  "GREECE TIME": "GRIECHISCHE ZEIT",
  "SNAPSHOT · RETRYING": "SNAPSHOT · NEUER VERSUCH",
  REC: "REC",
  "Close updates": "Updates schließen",
  "29 JUL 2026": "29. JUL 2026",
  ARCHIVE: "ARCHIV",
  "ARCHIVE · 29 JUL 2026": "ARCHIV · 29. JUL 2026",
  ACTION: "MASSNAHME",
  "Direct source": "Direkte Quelle",
  "SOURCE HEALTH": "QUELLENSTATUS",
  reachable: "erreichbar",
  failed: "fehlgeschlagen",
  "optional unconfigured": "optional nicht konfiguriert",
  CHECKING: "PRÜFUNG",
  "Reachable means the source responded—not that it published a new Plomari update.":
    "Erreichbar bedeutet, dass die Quelle geantwortet hat — nicht, dass sie ein neues Plomari-Update veröffentlicht hat.",
  "What-if simulation controls": "Steuerung der Was-wäre-wenn-Simulation",
  "SCENARIO ENGINE": "SZENARIO-ENGINE",
  "WHAT-IF ONLY · NOT A FORECAST":
    "NUR HYPOTHETISCH · KEINE VORHERSAGE",
  Horizon: "Horizont",
  h: "h",
  Wind: "Wind",
  Heading: "Richtung",
  "SW · modeled downwind": "SW · modelliert leeseitig",
  "S · Plomari": "S · Plomari",
  "W · Melinta": "W · Melinta",
  "SE · Agios Isidoros": "SO · Agios Isidoros",
  "Illustrative head": "Illustrative Front",
  "Current operating picture": "Aktuelles Lagebild",
  "OFFICIAL STATUS": "OFFIZIELLER STATUS",
  "Fire Service auto · latest 112 instruction remains manual":
    "Feuerwehr automatisch · letzte 112-Anweisung bleibt manuell",
  "SATELLITE THERMAL": "SATELLITENTHERMIK",
  "CHECKING FIRMS": "FIRMS WIRD GEPRÜFT",
  "POINT FEED UNAVAILABLE": "PUNKTFEED NICHT VERFÜGBAR",
  "No historical points substituted · raster is a separate layer":
    "Keine historischen Punkte ersetzt · Raster ist eine separate Ebene",
  "Zero detections is not an all-clear":
    "Null Detektionen sind keine Entwarnung",
  "FIRE-GRID MODEL": "MODELL BRANDGEBIET",
  Gust: "Böe",
  "model, not sensor": "Modell, kein Sensor",
  "POLLING 60 SECONDS": "ABFRAGE ALLE 60 SEKUNDEN",
  "Confidence legend": "Konfidenz-Legende",
  REPORTED: "GEMELDET",
  "MODELED / SIM": "MODELLIERT / SIM",
  "NOT AN OFFICIAL EMERGENCY PRODUCT":
    "KEIN OFFIZIELLES NOTFALLPRODUKT",
  "Interface baseline inspired by": "Oberflächenbasis inspiriert von",
  "Authorities override every map layer.":
    "Die Behörden haben Vorrang vor jeder Kartenebene.",

  // Ternary-resolved strings
  "Official alert feed. ": "Offizieller Warnfeed. ",
  "Official information feed; only 112 alerts are public protective instructions. ":
    "Offizieller Informationsfeed; nur 112-Warnungen sind öffentliche Schutzanweisungen. ",
  "Publisher feed item; publication time is unavailable, so recency is not verified. ":
    "Feed-Eintrag des Herausgebers; Veröffentlichungszeit nicht verfügbar, Aktualität daher nicht verifiziert. ",
  "Near-real-time local reporting; not independently confirmed. ":
    "Lokale Berichterstattung nahezu in Echtzeit; nicht unabhängig bestätigt. ",
  "Live-source retry in progress":
    "Neuer Verbindungsversuch zu Live-Quellen läuft",
  "No current live item returned":
    "Kein aktueller Live-Eintrag zurückgegeben",
  "Checking live sources": "Live-Quellen werden geprüft",
  "One local report referenced scattered activity near Agios Antonios at 20:50.":
    "Ein lokaler Bericht erwähnte um 20:50 verstreute Aktivität nahe Agios Antonios.",
  "The same report described activity in the direction of Megalochori; this second area is a broad reference zone.":
    "Derselbe Bericht beschrieb Aktivität in Richtung Megalochori; dieses zweite Gebiet ist eine grobe Referenzzone.",
  pass: "Überflug",
  passes: "Überflüge",
  "Checking official and local sources · Greece timestamps":
    "Offizielle und lokale Quellen werden geprüft · griechische Zeitstempel",

  // Static intel timeline (labels + details)
  "Aerial drops ended; scattered hotspots remain":
    "Löschflüge beendet; verstreute Glutnester verbleiben",
  "Local field reporting says aerial operations ended for the night, with scattered active hotspots around Agios Antonios and toward Megalochori. Strong winds are hampering ground crews. This is not an official containment statement.":
    "Laut lokaler Berichterstattung vor Ort wurden die Lufteinsätze für die Nacht beendet; verstreute aktive Glutnester verbleiben um Agios Antonios und Richtung Megalochori. Starker Wind behindert die Bodenkräfte. Dies ist keine offizielle Eindämmungsmeldung.",
  "No continuous front reported; rekindling risk":
    "Keine durchgehende Front gemeldet; Gefahr des Wiederaufflammens",
  "The deputy regional governor reported no active continuous front, but numerous scattered hotspots remained in difficult terrain. Crews stayed alert for rekindling. This was a local official statement, not a Fire Service all-clear.":
    "Der stellvertretende Regionalgouverneur meldete keine aktive durchgehende Front, aber zahlreiche verstreute Glutnester in schwierigem Gelände. Die Einsatzkräfte blieben wegen Wiederaufflammens wachsam. Dies war eine lokale offizielle Erklärung, keine Entwarnung der Feuerwehr.",
  "Hotspots reported near holiday homes":
    "Glutnester nahe Ferienhäusern gemeldet",
  "Local reporting said hotspots remained above Plomari near holiday homes. Residents and volunteers reportedly prevented flames from reaching houses.":
    "Lokale Berichte meldeten verbleibende Glutnester oberhalb von Plomari nahe Ferienhäusern. Anwohner und Freiwillige verhinderten demnach, dass Flammen die Häuser erreichten.",
  "Regional satellite smoke observed":
    "Regionaler Rauch per Satellit beobachtet",
  "Satellite imagery showed smoke from the Plomari incident and a major Turkish fire transported across Lesvos. This is a regional smoke snapshot, not a ground-level PM2.5 measurement.":
    "Satellitenbilder zeigten Rauch vom Plomari-Ereignis und einem großen türkischen Brand, der über Lesbos zog. Dies ist ein regionaler Rauch-Snapshot, keine PM2,5-Bodenmessung.",
  "Official 112 alert issued at 16:58":
    "Offizielle 112-Warnung um 16:58 ausgegeben",
  "People in the Plomari area were instructed to move toward Plomari beach in the direction of Agios Isidoros. This reproduces the alert issued at 16:58; check the incident wire and authorities for any newer instruction.":
    "Personen im Gebiet Plomari wurden angewiesen, sich zum Strand von Plomari in Richtung Agios Isidoros zu begeben. Dies gibt die um 16:58 ausgegebene Warnung wieder; prüfen Sie den Ereignis-Ticker und die Behörden auf neuere Anweisungen.",
  "Fire Service response reinforced":
    "Feuerwehreinsatz verstärkt",
  "Fire Service reported 50 firefighters, two 12th EMODE teams, volunteers, 13 vehicles, three aircraft and three helicopters.":
    "Die Feuerwehr meldete 50 Feuerwehrleute, zwei Teams der 12. EMODE, Freiwillige, 13 Fahrzeuge, drei Flugzeuge und drei Hubschrauber.",
  "Latest satellite heat": "Neueste Satellitenwärme",
  "Aqua MODIS detected active heat near Chalkelia. A satellite point is an observed hot pixel, not a fire perimeter.":
    "Aqua MODIS erkannte aktive Wärme nahe Chalkelia. Ein Satellitenpunkt ist ein beobachtetes heißes Pixel, kein Brandperimeter.",
  "NOAA-20 pass": "NOAA-20-Überflug",
  "Six VIIRS hot pixels were detected near the incident, including three high-confidence detections.":
    "Sechs heiße VIIRS-Pixel wurden nahe dem Ereignis erkannt, darunter drei Detektionen hoher Konfidenz.",
  "Fire reported": "Brand gemeldet",
  "The incident was reported around the restored Chalkelia landfill, north-east of Plomari.":
    "Das Ereignis wurde im Bereich der sanierten Deponie Chalkelia nordöstlich von Plomari gemeldet.",

  // Sources list (labels + kinds)
  "Fire Service board": "Feuerwehr-Einsatztafel",
  "Official incident status · automatic":
    "Offizieller Ereignisstatus · automatisch",
  "112 Greece": "112 Griechenland",
  "Protective guidance": "Schutzhinweise",
  "Official safety instructions": "Offizielle Sicherheitsanweisungen",
  "Official response · 16:34": "Offizielle Reaktion · 16:34",
  "StoNisi overnight": "StoNisi über Nacht",
  "Local field report · 20:50": "Lokaler Feldbericht · 20:50",
  Aeolos: "Aeolos",
  "Local reporting · repeated rekindling":
    "Lokale Berichterstattung · wiederholtes Wiederaufflammen",
  "Satellite smoke": "Satellitenrauch",
  "Regional smoke report · 17:50": "Regionaler Rauchbericht · 17:50",
  "NASA FIRMS": "NASA FIRMS",
  "Thermal points · server-side API": "Thermalpunkte · serverseitige API",
  "NASA GIBS": "NASA GIBS",
  "No-key thermal / aerosol overlay":
    "Thermal-/Aerosol-Ebene ohne Schlüssel",
  "Open-Meteo": "Open-Meteo",
  "Detailed point wind model": "Detailliertes Punkt-Windmodell",
  AviationWeather: "AviationWeather",
  "Measured LGMT airport METAR": "Gemessenes METAR des Flughafens LGMT",

  // Live feed summaries (from the updates API)
  "Item from an official source. Open the direct source for the full statement and any instructions.":
    "Eintrag aus offizieller Quelle. Öffnen Sie die direkte Quelle für die vollständige Erklärung und etwaige Anweisungen.",
  "Headline link from the publisher; open the direct source for the full report.":
    "Schlagzeilen-Link des Herausgebers; öffnen Sie die direkte Quelle für den vollständigen Bericht.",
  "Live local-reporting page; open the direct source for the full chronology and field details.":
    "Lokale Live-Berichtsseite; öffnen Sie die direkte Quelle für die vollständige Chronologie und Felddetails.",
  "Direct post from an official account. Follow the linked instruction and authorities on the ground.":
    "Direkter Beitrag eines offiziellen Kontos. Folgen Sie der verlinkten Anweisung und den Behörden vor Ort.",
};

export const IT: TranslationMap = {
  // Air quality bands (EEA scale)
  GOOD: "BUONA",
  FAIR: "DISCRETA",
  MODERATE: "MODERATA",
  POOR: "SCARSA",
  "VERY POOR": "MOLTO SCARSA",
  "EXTREMELY POOR": "ESTREMAMENTE SCARSA",

  // Confidence labels
  OFFICIAL: "UFFICIALE",
  OBSERVED: "OSSERVATO",
  "LOCAL REPORT": "SEGNALAZIONE LOCALE",
  MODELED: "MODELLIZZATO",
  "age unknown": "età sconosciuta",
  High: "Alta",
  Nominal: "Nominale",
  Low: "Bassa",
  Unknown: "Sconosciuta",

  // Update categories
  Evacuation: "Evacuazione",
  Readiness: "Allerta",
  Road: "Rete stradale",
  Smoke: "Fumo",
  Rekindling: "Ripresa del fuoco",
  Control: "Controllo",
  Response: "Intervento",
  Incident: "Evento",

  // Fire service / incident wire
  "Fire Service": "Vigili del Fuoco",
  "STATUS PENDING": "STATO IN ATTESA",
  "The official incident board lists the Plomari landfill fire as":
    "Il quadro ufficiale degli eventi classifica l'incendio della discarica di Plomari come",
  "The board does not provide a perimeter or public route instruction.":
    "Il quadro non fornisce un perimetro né istruzioni pubbliche sui percorsi.",
  "No archived chronology item is selected by default. Dated archive entries remain available in the list while current sources are checked.":
    "Nessun elemento archiviato della cronologia è selezionato per impostazione predefinita. Le voci datate dell'archivio restano disponibili nell'elenco mentre si verificano le fonti attuali.",
  "Loading FIRMS point feed": "Caricamento del flusso di punti FIRMS",
  "FIRMS point feed unavailable": "Flusso di punti FIRMS non disponibile",
  "latest detecting pass": "ultimo passaggio con rilevamenti",
  "last 6 hours": "ultime 6 ore",
  "last 24 hours": "ultime 24 ore",

  // Place labels
  MELINTA: "MELINTA",
  "PLOMARI BEACH": "SPIAGGIA DI PLOMARI",
  MILIES: "MILIES",
  PLAGIA: "PLAGIA",
  "AGIOS ISIDOROS": "AGIOS ISIDOROS",
  "AGIOS ANTONIOS": "AGIOS ANTONIOS",
  MEGALOCHORI: "MEGALOCHORI",
  PERAMA: "PERAMA",
  PLOMARI: "PLOMARI",

  // Map annotations
  "Restored Chalkelia landfill footprint · not the fire perimeter":
    "Area della discarica bonificata di Chalkelia · non è il perimetro dell'incendio",
  "REPORTED INCIDENT AREA": "AREA DELL'EVENTO SEGNALATA",
  "Restored Chalkelia landfill.": "Discarica bonificata di Chalkelia.",
  "Site location only · perimeter not published.":
    "Solo posizione del sito · perimetro non pubblicato.",
  INCIDENT: "EVENTO",
  "16:58 official 112 direction: Plomari beach → Agios Isidoros · historical alert, verify any newer instruction":
    "Istruzione ufficiale 112 delle 16:58: spiaggia di Plomari → Agios Isidoros · allerta storica, verificare eventuali istruzioni più recenti",
  "112 · 16:58 →": "112 · 16:58 →",
  "nominal 375 m pixel": "pixel nominale di 375 m",
  "SATELLITE THERMAL DETECTION": "RILEVAMENTO TERMICO SATELLITARE",
  "Greece time": "ora della Grecia",
  "Detection confidence": "Affidabilità del rilevamento",
  "of incident reference": "dal riferimento dell'evento",
  "Marker is the pixel center. The halo approximates pixel dimensions, not a fire perimeter. FRP is pixel-integrated radiative power—not flame height or total fire intensity.":
    "Il marcatore è il centro del pixel. L'alone approssima le dimensioni del pixel, non un perimetro dell'incendio. La FRP è la potenza radiativa integrata del pixel — non l'altezza delle fiamme né l'intensità totale del fuoco.",
  "FIELD-REPORTED AREA (APPROXIMATE)": "AREA SEGNALATA SUL CAMPO (APPROSSIMATIVA)",
  "Approximate only · not an official perimeter or live flame location.":
    "Solo approssimativa · non è un perimetro ufficiale né la posizione in tempo reale delle fiamme.",
  "FIELD REPORT · 20:50": "RAPPORTO DAL CAMPO · 20:50",
  "LGMT MEASURED WIND": "VENTO MISURATO LGMT",
  gust: "raffica",
  "NASA VIIRS daylight aerosol classification · smoke retrieval is coarse, cloud-sensitive and not surface PM2.5":
    "Classificazione diurna degli aerosol NASA VIIRS · il rilevamento del fumo è grossolano, sensibile alle nubi e non corrisponde al PM2,5 al suolo",
  "Higher-confidence centerline of an illustrative wind-driven envelope · terrain and fire behavior are not modeled":
    "Linea centrale a maggiore affidabilità di un inviluppo illustrativo guidato dal vento · terreno e comportamento del fuoco non sono modellizzati",
  "Interactive Plomari wildfire operational map":
    "Mappa operativa interattiva dell'incendio di Plomari",
  "ACQUIRING MAP…": "CARICAMENTO MAPPA…",
  "OFFLINE — DISPLAYING THE LAST AVAILABLE SNAPSHOT":
    "OFFLINE — VISUALIZZAZIONE DELL'ULTIMA ISTANTANEA DISPONIBILE",
  "LOCAL INCIDENT PICTURE · MULTISOURCE OSINT":
    "QUADRO LOCALE DELL'EVENTO · OSINT MULTIFONTE",
  "FIRE SERVICE": "VIGILI DEL FUOCO",
  "GREECE LOCAL": "ORA LOCALE DELLA GRECIA",
  Language: "Lingua",
  "FIRE BOARD AUTO · 112 MANUAL": "QUADRO INCENDI AUTO · 112 MANUALE",
  "Archived 112 instruction issued at 16:58; not a current verification":
    "Istruzione 112 archiviata emessa alle 16:58; non è una verifica attuale",
  "ARCHIVED 112 · ISSUED 16:58 · NOT LIVE":
    "112 ARCHIVIATO · EMESSO 16:58 · NON IN DIRETTA",
  "Archived instruction — not a current verification. Follow newer 112 messages.":
    "Istruzione archiviata — non è una verifica attuale. Seguire i messaggi 112 più recenti.",
  source: "fonte",
  "Official alert": "Allerta ufficiale",
  "Call 112": "Chiamare il 112",
  CALL: "CHIAMA",
  "Map style": "Stile mappa",
  dark: "scuro",
  satellite: "satellite",
  terrain: "terreno",
  "Close panel": "Chiudi pannello",
  "HIDE LAYERS": "NASCONDI LIVELLI",
  LAYERS: "LIVELLI",
  "Data layers": "Livelli di dati",
  "DATA LAYERS": "LIVELLI DI DATI",
  "8 LAYERS // SOURCE + FRESHNESS VISIBLE":
    "8 LIVELLI // FONTE + AGGIORNAMENTO VISIBILI",
  FRAME: "INQUADRA",
  "Close layers": "Chiudi livelli",
  "112 evacuation": "Evacuazione 112",
  "Original official alert · 16:58": "Allerta ufficiale originale · 16:58",
  "Satellite thermal detections": "Rilevamenti termici satellitari",
  "Daily thermal raster": "Raster termico giornaliero",
  "NASA GIBS imagery · not extra points":
    "Immagini NASA GIBS · nessun punto aggiuntivo",
  "Field-reported areas (approx.)": "Aree segnalate sul campo (appross.)",
  "1 report · 2 reference areas · 20:50":
    "1 rapporto · 2 aree di riferimento · 20:50",
  "Wind profile": "Profilo del vento",
  "Satellite aerosol / smoke": "Aerosol / fumo satellitare",
  "NASA VIIRS NRT · daylight snapshot":
    "NASA VIIRS NRT · istantanea diurna",
  "Smoke transport proxy": "Modello indicativo di trasporto del fumo",
  "Modeled wind envelope · not PM2.5":
    "Inviluppo di vento modellizzato · non PM2,5",
  "What-if envelope": "Inviluppo ipotetico",
  "Simulation · never route from this":
    "Simulazione · non pianificare mai percorsi da questa",
  "Satellite thermal detection key": "Legenda rilevamento termico satellitare",
  "SATELLITE DETECTION KEY": "LEGENDA RILEVAMENTO SATELLITARE",
  LOADING: "CARICAMENTO",
  UNAVAILABLE: "NON DISPONIBILE",
  RETRYING: "NUOVO TENTATIVO",
  PARTIAL: "PARZIALE",
  AVAILABLE: "DISPONIBILE",
  "Thermal observation window": "Finestra di osservazione termica",
  "LATEST DETECTING PASS": "ULTIMO PASSAGGIO CON RILEVAMENTI",
  "6 HOURS": "6 ORE",
  "24 HOURS": "24 ORE",
  "detection records": "record di rilevamento",
  Window: "Finestra",
  "latest observation": "ultima osservazione",
  "Each marker is the center of a satellite pixel where a thermal anomaly was detected during one overpass. It is not a live flame location, a fire perimeter, or a count of fires.":
    "Ogni marcatore è il centro di un pixel satellitare in cui è stata rilevata un'anomalia termica durante un passaggio. Non è una posizione in tempo reale delle fiamme, né un perimetro dell'incendio, né un conteggio degli incendi.",
  "FIRMS point feed unavailable — showing no point count. The optional NASA daily raster can be enabled separately.":
    "Flusso di punti FIRMS non disponibile — nessun conteggio di punti mostrato. Il raster giornaliero opzionale della NASA può essere attivato separatamente.",
  "No thermal detections were returned for this area in the selected window. This does not mean the fire is out; clouds, satellite timing, and sensor limits can hide activity.":
    "Nessun rilevamento termico restituito per quest'area nella finestra selezionata. Ciò non significa che l'incendio sia spento; nubi, orari dei satelliti e limiti dei sensori possono nascondere l'attività.",
  HIGH: "ALTA",
  "saturated fire pixel": "pixel di fuoco saturo",
  NOMINAL: "NOMINALE",
  "strong anomaly; no daytime sun-glint flag":
    "anomalia forte; nessun indicatore diurno di riflesso solare",
  LOW: "BASSA",
  "lower confidence / sun-glint prone":
    "affidabilità inferiore / soggetto a riflessi solari",
  "Confidence describes detection quality, not fire severity. FRP is pixel-integrated radiative power; not flame height or total fire intensity.":
    "L'affidabilità descrive la qualità del rilevamento, non la gravità dell'incendio. La FRP è la potenza radiativa integrata del pixel; non l'altezza delle fiamme né l'intensità totale del fuoco.",
  Retrieved: "Recuperato",
  "app checks every 5 min; satellite passes are not continuous":
    "l'app verifica ogni 5 min; i passaggi satellitari non sono continui",
  "FIRE-GRID WIND MODEL": "MODELLO DEL VENTO NELL'AREA DELL'INCENDIO",
  "SNAPSHOT / RETRYING": "ISTANTANEA / NUOVO TENTATIVO",
  FROM: "DA",
  GUST: "RAFFICA",
  MODEL: "MODELLO",
  "FIRE AREA": "AREA DELL'INCENDIO",
  "LGMT MEASURED": "MISURATO LGMT",
  "Smoke proxy horizon": "Orizzonte del modello di fumo",
  min: "min",
  "HIDE UPDATES": "NASCONDI AGGIORNAMENTI",
  UPDATES: "AGGIORNAMENTI",
  "Mobile map navigation": "Navigazione mobile della mappa",
  MAP: "MAPPA",
  "Incident updates": "Aggiornamenti sull'evento",
  "INCIDENT WIRE": "CANALE DELL'EVENTO",
  "GREECE TIME": "ORA DELLA GRECIA",
  "SNAPSHOT · RETRYING": "ISTANTANEA · NUOVO TENTATIVO",
  REC: "REC",
  "Close updates": "Chiudi aggiornamenti",
  "29 JUL 2026": "29 LUG 2026",
  ARCHIVE: "ARCHIVIO",
  "ARCHIVE · 29 JUL 2026": "ARCHIVIO · 29 LUG 2026",
  ACTION: "AZIONE",
  "Direct source": "Fonte diretta",
  "SOURCE HEALTH": "STATO DELLE FONTI",
  reachable: "raggiungibili",
  failed: "non riuscite",
  "optional unconfigured": "opzionali non configurate",
  CHECKING: "VERIFICA",
  "Reachable means the source responded—not that it published a new Plomari update.":
    "Raggiungibile significa che la fonte ha risposto — non che abbia pubblicato un nuovo aggiornamento su Plomari.",
  "What-if simulation controls": "Controlli della simulazione ipotetica",
  "SCENARIO ENGINE": "MOTORE DI SCENARI",
  "WHAT-IF ONLY · NOT A FORECAST":
    "SOLO IPOTETICO · NON È UNA PREVISIONE",
  Horizon: "Orizzonte",
  h: "h",
  Wind: "Vento",
  Heading: "Direzione",
  "SW · modeled downwind": "SO · sottovento modellizzato",
  "S · Plomari": "S · Plomari",
  "W · Melinta": "O · Melinta",
  "SE · Agios Isidoros": "SE · Agios Isidoros",
  "Illustrative head": "Fronte illustrativo",
  "Current operating picture": "Quadro operativo attuale",
  "OFFICIAL STATUS": "STATO UFFICIALE",
  "Fire Service auto · latest 112 instruction remains manual":
    "Vigili del Fuoco automatico · l'ultima istruzione 112 resta manuale",
  "SATELLITE THERMAL": "TERMICO SATELLITARE",
  "CHECKING FIRMS": "VERIFICA FIRMS",
  "POINT FEED UNAVAILABLE": "FLUSSO DI PUNTI NON DISPONIBILE",
  "No historical points substituted · raster is a separate layer":
    "Nessun punto storico sostituito · il raster è un livello separato",
  "Zero detections is not an all-clear":
    "Zero rilevamenti non significa cessata allerta",
  "FIRE-GRID MODEL": "MODELLO DELL'AREA DELL'INCENDIO",
  Gust: "Raffica",
  "model, not sensor": "modello, non sensore",
  "POLLING 60 SECONDS": "INTERROGAZIONE OGNI 60 SECONDI",
  "Confidence legend": "Legenda dell'affidabilità",
  REPORTED: "SEGNALATO",
  "MODELED / SIM": "MODELLIZZATO / SIM",
  "NOT AN OFFICIAL EMERGENCY PRODUCT":
    "NON È UN PRODOTTO UFFICIALE DI EMERGENZA",
  "Interface baseline inspired by": "Interfaccia di base ispirata a",
  "Authorities override every map layer.":
    "Le autorità prevalgono su ogni livello della mappa.",

  // Ternary-resolved strings
  "Official alert feed. ": "Flusso ufficiale di allerte. ",
  "Official information feed; only 112 alerts are public protective instructions. ":
    "Flusso ufficiale di informazioni; solo le allerte 112 sono istruzioni pubbliche di protezione. ",
  "Publisher feed item; publication time is unavailable, so recency is not verified. ":
    "Elemento del flusso dell'editore; l'ora di pubblicazione non è disponibile, quindi l'attualità non è verificata. ",
  "Near-real-time local reporting; not independently confirmed. ":
    "Informazione locale quasi in tempo reale; non confermata in modo indipendente. ",
  "Live-source retry in progress":
    "Nuovo tentativo di connessione alle fonti in diretta in corso",
  "No current live item returned":
    "Nessun elemento in diretta attuale restituito",
  "Checking live sources": "Verifica delle fonti in diretta",
  "One local report referenced scattered activity near Agios Antonios at 20:50.":
    "Una segnalazione locale ha riferito attività sparsa vicino ad Agios Antonios alle 20:50.",
  "The same report described activity in the direction of Megalochori; this second area is a broad reference zone.":
    "La stessa segnalazione ha descritto attività in direzione di Megalochori; questa seconda area è un'ampia zona di riferimento.",
  pass: "passaggio",
  passes: "passaggi",
  "Checking official and local sources · Greece timestamps":
    "Verifica delle fonti ufficiali e locali · orari della Grecia",

  // Static intel timeline (labels + details)
  "Aerial drops ended; scattered hotspots remain":
    "Terminati i lanci aerei; restano focolai sparsi",
  "Local field reporting says aerial operations ended for the night, with scattered active hotspots around Agios Antonios and toward Megalochori. Strong winds are hampering ground crews. This is not an official containment statement.":
    "Secondo le informazioni locali dal campo, le operazioni aeree sono terminate per la notte, con focolai attivi sparsi intorno ad Agios Antonios e verso Megalochori. I venti forti ostacolano le squadre a terra. Non è una dichiarazione ufficiale di contenimento.",
  "No continuous front reported; rekindling risk":
    "Nessun fronte continuo segnalato; rischio di riprese del fuoco",
  "The deputy regional governor reported no active continuous front, but numerous scattered hotspots remained in difficult terrain. Crews stayed alert for rekindling. This was a local official statement, not a Fire Service all-clear.":
    "Il vicegovernatore regionale ha riferito che non c'era un fronte continuo attivo, ma restavano numerosi focolai sparsi su terreno difficile. Le squadre sono rimaste in allerta per le riprese del fuoco. Era una dichiarazione ufficiale locale, non un cessato allarme dei Vigili del Fuoco.",
  "Hotspots reported near holiday homes":
    "Focolai segnalati vicino a case vacanza",
  "Local reporting said hotspots remained above Plomari near holiday homes. Residents and volunteers reportedly prevented flames from reaching houses.":
    "La stampa locale ha riferito che restavano focolai sopra Plomari, vicino a case vacanza. Secondo le segnalazioni, residenti e volontari hanno impedito alle fiamme di raggiungere le abitazioni.",
  "Regional satellite smoke observed":
    "Fumo regionale osservato da satellite",
  "Satellite imagery showed smoke from the Plomari incident and a major Turkish fire transported across Lesvos. This is a regional smoke snapshot, not a ground-level PM2.5 measurement.":
    "Le immagini satellitari hanno mostrato fumo dall'evento di Plomari e da un grande incendio turco trasportato su Lesbo. È un'istantanea regionale del fumo, non una misurazione del PM2,5 al suolo.",
  "Official 112 alert issued at 16:58":
    "Allerta ufficiale 112 emessa alle 16:58",
  "People in the Plomari area were instructed to move toward Plomari beach in the direction of Agios Isidoros. This reproduces the alert issued at 16:58; check the incident wire and authorities for any newer instruction.":
    "Alle persone nell'area di Plomari è stato indicato di dirigersi verso la spiaggia di Plomari in direzione di Agios Isidoros. Questo riproduce l'allerta emessa alle 16:58; consultare il canale dell'evento e le autorità per eventuali istruzioni più recenti.",
  "Fire Service response reinforced":
    "Rafforzata la risposta dei Vigili del Fuoco",
  "Fire Service reported 50 firefighters, two 12th EMODE teams, volunteers, 13 vehicles, three aircraft and three helicopters.":
    "I Vigili del Fuoco hanno riferito di 50 vigili, due squadre della 12ª EMODE, volontari, 13 veicoli, tre aerei e tre elicotteri.",
  "Latest satellite heat": "Ultimo calore satellitare",
  "Aqua MODIS detected active heat near Chalkelia. A satellite point is an observed hot pixel, not a fire perimeter.":
    "Aqua MODIS ha rilevato calore attivo vicino a Chalkelia. Un punto satellitare è un pixel caldo osservato, non un perimetro dell'incendio.",
  "NOAA-20 pass": "Passaggio di NOAA-20",
  "Six VIIRS hot pixels were detected near the incident, including three high-confidence detections.":
    "Sei pixel caldi VIIRS sono stati rilevati vicino all'evento, di cui tre rilevamenti ad alta affidabilità.",
  "Fire reported": "Incendio segnalato",
  "The incident was reported around the restored Chalkelia landfill, north-east of Plomari.":
    "L'evento è stato segnalato nell'area della discarica bonificata di Chalkelia, a nord-est di Plomari.",

  // Sources list (labels + kinds)
  "Fire Service board": "Quadro dei Vigili del Fuoco",
  "Official incident status · automatic":
    "Stato ufficiale dell'evento · automatico",
  "112 Greece": "112 Grecia",
  "Protective guidance": "Indicazioni di protezione",
  "Official safety instructions": "Istruzioni ufficiali di sicurezza",
  "Official response · 16:34": "Risposta ufficiale · 16:34",
  "StoNisi overnight": "StoNisi durante la notte",
  "Local field report · 20:50": "Rapporto locale dal campo · 20:50",
  Aeolos: "Aeolos",
  "Local reporting · repeated rekindling":
    "Stampa locale · riprese del fuoco ripetute",
  "Satellite smoke": "Fumo satellitare",
  "Regional smoke report · 17:50": "Rapporto regionale sul fumo · 17:50",
  "NASA FIRMS": "NASA FIRMS",
  "Thermal points · server-side API": "Punti termici · API lato server",
  "NASA GIBS": "NASA GIBS",
  "No-key thermal / aerosol overlay":
    "Livello termico / aerosol senza chiave",
  "Open-Meteo": "Open-Meteo",
  "Detailed point wind model": "Modello di vento puntuale dettagliato",
  AviationWeather: "AviationWeather",
  "Measured LGMT airport METAR": "METAR misurato dell'aeroporto LGMT",

  // Live feed summaries (from the updates API)
  "Item from an official source. Open the direct source for the full statement and any instructions.":
    "Elemento da una fonte ufficiale. Aprire la fonte diretta per la dichiarazione completa ed eventuali istruzioni.",
  "Headline link from the publisher; open the direct source for the full report.":
    "Link del titolo dall'editore; aprire la fonte diretta per il servizio completo.",
  "Live local-reporting page; open the direct source for the full chronology and field details.":
    "Pagina locale di informazione in diretta; aprire la fonte diretta per la cronologia completa e i dettagli dal campo.",
  "Direct post from an official account. Follow the linked instruction and authorities on the ground.":
    "Post diretto da un account ufficiale. Seguire l'istruzione collegata e le autorità sul territorio.",
};
