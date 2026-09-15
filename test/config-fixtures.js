import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export async function configurationFixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'prusamcp-config-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const profilesDir=join(directory,'profiles');
  await mkdir(join(profilesDir,'vendor'),{recursive:true});
  await writeFile(join(profilesDir,'PrusaSlicer.ini'),'version = 2.9.6\n\n[vendor:Synthetic]\nmodel:SYNTH = 0.4\n');
  await writeFile(join(profilesDir,'vendor','Synthetic.ini'),`[vendor]
name = Synthetic Test Vendor
config_version = 1.0.0

[printer_model:SYNTH]
name = Synthetic Test Printer
variants = 0.4
technology = FFF

[printer:*printer-base*]
printer_technology = FFF
bed_shape = 0x0,250x0,250x220,0x220
nozzle_diameter = 0.4
max_print_height = 230

[printer:Synthetic Printer]
inherits = *printer-base*
printer_model = SYNTH
printer_variant = 0.4

[print:*print-base*]
layer_height = 0.17
fill_density = 23%

[print:Synthetic Print]
inherits = *print-base*
compatible_printers_condition = printer_model=="SYNTH"

[filament:Synthetic Material]
filament_type = PLA
temperature = 217
compatible_printers_condition = printer_model=="SYNTH"
`);
  return { directory, profilesDir, config:{profilesDir,executablePath:process.env.PRUSASLICER_REAL_TEST} };
}
