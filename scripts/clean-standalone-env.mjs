import {existsSync,readdirSync,rmSync} from 'node:fs';
const directory='.next/standalone';
// Quitar únicamente las copias generadas por Next, nunca la configuración fuente.
if(existsSync(directory))for(const entry of readdirSync(directory,{withFileTypes:true}))
 if(entry.isFile()&&entry.name.startsWith('.env'))rmSync(`${directory}/${entry.name}`);

// Un build genérico no conserva la identidad de un build anterior.
rmSync('.next/vvn-deployment.json',{force:true});
