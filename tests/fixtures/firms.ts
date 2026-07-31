import { FIRMS_MAX_RESPONSE_BYTES } from "../../lib/satellite/firms";

export const FIRMS_VIIRS_HEADER =
  "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight";
export const FIRMS_MODIS_HEADER =
  "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight";

export const FIRMS_VIIRS_CSV = `${FIRMS_VIIRS_HEADER}\n38.97510,26.36620,341.20,0.39,0.36,2026-07-29,1542,N20,VIIRS,n,2.0NRT,301.45,8.10,D\n38.98120,26.37140,329.40,0.41,0.38,2026-07-29,7,N20,VIIRS,h,2.0NRT,296.20,5.40,N\n`;

export const FIRMS_MODIS_CSV = `${FIRMS_MODIS_HEADER}\n38.96980,26.35510,318.70,1.03,1.01,2026-07-29,1635,Terra,MODIS,87,6.1NRT,293.20,12.50,D\n`;

export const FIRMS_HEADER_ONLY_CSV = `${FIRMS_VIIRS_HEADER}\n`;

export const FIRMS_MALFORMED_HEADER_CSV =
  "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,frp,daynight\n";

export const FIRMS_MALFORMED_ROWS_CSV = `${FIRMS_VIIRS_HEADER}\n91,26.36620,341.20,0.39,0.36,2026-07-29,1542,N20,VIIRS,n,2.0NRT,301.45,8.10,D\n38.97510,26.36620,341.20,0.39,0.36,2026-07-29,1542,N20,VIIRS,n,2.0NRT,301.45,8.10\n`;

export function oversizedFirmsCsv() {
  const bytes = new Uint8Array(FIRMS_MAX_RESPONSE_BYTES + 1);
  bytes.fill(0x20);
  return bytes;
}
