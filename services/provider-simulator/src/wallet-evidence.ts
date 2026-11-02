/** Shared SQL predicate for a readable reference-only superapp wallet capture. */
export const unboundLegacyWalletCharge = `CASE WHEN json_valid(body)=0 THEN 0 WHEN json_type(body)<>'object' THEN 0
  WHEN json_extract(body,'$.merchant')='superapp' AND json_extract(body,'$.source')='wallet'
    AND (coalesce(json_type(body,'$.operationId'),'')<>'text' OR length(json_extract(body,'$.operationId')) NOT BETWEEN 1 AND 200 OR json_extract(body,'$.operationId') GLOB '*[^A-Za-z0-9_.:-]*')
    AND coalesce(json_extract(body,'$.status'),'')<>'DECLINED' THEN 1 ELSE 0 END`;
