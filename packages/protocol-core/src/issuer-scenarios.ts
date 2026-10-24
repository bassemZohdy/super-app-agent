/** Operator controls exist only in explicitly isolated issuer runs. These fields are not payment inputs. */
export const issuerScenarioPresets=['approved','declined','limit','expired','disabled','challenge','pending','refund-failure'] as const;
export type IssuerScenarioPreset=typeof issuerScenarioPresets[number];
const id={type:'string',minLength:1,maxLength:160,pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]*$'},version={type:'integer',minimum:1,maximum:1000000},key={type:'string',pattern:'^[A-Za-z0-9_-]{8,100}$'};
const object=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const issuerScenarioSchemas={configuration:object({accountId:id,methodId:id,expectedMethodVersion:version,expectedRevision:{type:'integer',minimum:0,maximum:1000},preset:{enum:issuerScenarioPresets},requestKey:key}),pending:object({accountId:id,orderId:id,decision:{enum:['APPROVE','DECLINE']},requestKey:key})};
