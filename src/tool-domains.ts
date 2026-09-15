import { z } from "zod";
import { artifactRefSchema } from "./contracts.js";
const n = z.number(), s = z.string(), b = z.boolean(), strings = z.array(s);
const scalar = z.union([s, n, b]);
export const meshSchema = z.object({ triangleCount:n, boundingBox:z.object({min:z.object({x:n,y:n,z:n}),max:z.object({x:n,y:n,z:n}),size:z.object({x:n,y:n,z:n})}), volume:n, surfaceArea:n, overhangPercent:n, overhangTriangles:n, hasSmallDetails:b, smallDetailPercent:n, isManifold:b, nonManifoldEdges:n });
export const profileSchema = z.object({ goal:s, printer:s, nozzle:n, material:s, settings:z.record(z.object({value:scalar,reason:s})), warnings:strings });
export const costSchema = z.object({filamentWeightG:n,filamentLengthMm:n,filamentCostEur:n,electricityCostEur:n,totalCostEur:n,printTimeSeconds:n,printTimeFormatted:s});
const diagnosis = z.object({defect:s,symptoms:strings,causes:strings,fixes:strings});
const report = z.object({score:n,summary:s,issues:z.array(z.object({severity:z.enum(["error","warning","info"]),category:s,message:s,detail:s.optional(),bibleFdmRef:s.optional()})),diagnosticHints:z.array(diagnosis).optional()});
const orientation = z.object({name:s,rotation:z.object({axisX:n,axisY:n,axisZ:n}),overhangPercent:n,supportVolume:n,printHeight:n,bedContact:n,score:n,reasoning:s});
const field = z.object({parameter:s,value:scalar.nullable(),enabled:b,role:s,section:s.nullable()});
const fieldRead = z.object({source:z.literal("live_gui"),coverage:s,window_id:n,title:s,fields:z.array(field)});
const permission = z.enum(["granted","denied","unknown"]);
const backend = z.object({state:z.enum(["available","unavailable","unsupported","blocked","unknown"]),requires:strings,limitations:strings.optional()});
export const capabilitiesSchema = z.object({host:s,platform:s,cli:z.object({state:z.enum(["available","unavailable"]),executable:s.nullable(),version:s.nullable(),tested_version:b,technologies:z.object({FFF:b,SLA:b}),options:strings,actions:strings,transforms:strings,limitations:strings,error_code:s.optional()}),files:z.object({state:z.literal("available"),limitations:strings}),macos:z.object({supported:b,probe_process:s,permissions:z.object({screen_recording:permission,accessibility:permission,automation:permission,gui_session:z.enum(["active","absent","unknown"])}),backends:z.object({jxa_gui:backend,capture:backend})})});
const feedbackStats = z.object({totalPrints:n,successRate:n,avgQuality:n,avgAdhesion:n,avgStrength:n,commonIssues:z.array(z.object({issue:s,count:n,percent:n})),bestSettings:z.array(z.object({material:s,layerHeight:n,avgScore:n,count:n}))});
export const domains = {
  analyze_mesh:z.object({name:s,analysis:meshSchema}),
  recommend_profile:z.object({profile:profileSchema,analysis:meshSchema.optional()}),
  generate_prusaslicer_config:z.object({artifact:artifactRefSchema,settings:z.record(scalar),ini:s}),
  check_printability:z.object({report}),
  suggest_orientation:z.object({orientations:z.array(orientation)}),
  estimate_cost:z.object({estimates:z.array(z.object({goal:s,estimate:costSchema}))}),
  print_wizard:z.object({analysis:meshSchema,report,orientations:z.array(orientation),profile:profileSchema.optional(),cost:costSchema.optional(),questions:z.array(z.object({question:s,options:strings}))}),
  search_filament:z.object({filaments:z.array(z.object({brand:s,name:s,material:s,nozzleTemp:z.tuple([n,n]),bedTemp:z.tuple([n,n]),fanSpeed:z.tuple([n,n]),density:n,maxVolumetricSpeed:n,pricePerKg:n.optional(),notes:s,requiresEnclosure:b.optional(),recommendedSurface:s.optional()}))}),
  diagnose_print:z.object({diagnoses:z.array(diagnosis.extend({aliases:strings,preventionSettings:z.record(s)})),available_defects:strings.optional(),material_notes:strings.optional()}),
  submit_feedback:z.object({id:s,stored:b}),
  feedback_stats:z.object({stats:feedbackStats,community_prints:n}),
  export_feedback:z.object({print_count:n,export_date:s.nullable(),feedbacks:z.array(z.object({material:s,printerType:s,nozzle:n,goal:s,layerHeight:n,infillPercent:n,printSpeed:n,nozzleTemp:n,bedTemp:n,supportUsed:b,qualityScore:n,adhesionScore:n,strengthScore:n,overallScore:n,issues:strings}))}),
  slice_prusaslicer:z.object({artifact:artifactRefSchema,exit_code:z.literal(0),stats:z.object({estimatedTime:s.optional(),estimatedTimeSeconds:n.optional(),filamentUsedMm:n.optional(),filamentUsedG:n.optional(),filamentCost:n.optional(),layerCount:n.optional()}),post_process_policy:s}),
  get_current_model:z.object({window_title:s,file_path:s.nullable(),presets:z.object({skeinDirectory:s.nullable(),currentPrinter:s.nullable(),currentFilament:s.nullable(),currentPrintProfile:s.nullable()}),analysis:meshSchema.optional()}),
  read_prusaslicer_fields:fieldRead,
  open_prusaslicer_tab:fieldRead,
  set_prusaslicer_field:z.union([
    z.object({changed:z.literal(false),saved:z.literal(false),field}),
    z.object({editor_changed:z.literal(true).nullable(),saved:z.literal(false),parameter:s,verification:s,committed:z.null().optional(),message:s.optional(),requested:s.optional(),actual:scalar.nullable().optional()}),
  ]),
  screenshot_prusaslicer:z.object({image:z.object({media_type:z.literal("image/png"),content_index:z.literal(0)})}),
  postprocess_gcode:z.object({changed:b,inserted:n,skipped:n,output_path:s.optional()}),
  upload_print:z.object({http_status:n,file_name:s,server:s,start_requested:b,physical_state:z.literal("unknown")}),
  get_capabilities:capabilitiesSchema,
};
export type ToolName = keyof typeof domains;
