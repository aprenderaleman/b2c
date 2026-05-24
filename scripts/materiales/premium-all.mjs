// Genera 70 PDFs premium (solo presentación, sin cuaderno).
// Usa logo-small.png embebido (14KB) en lugar del original 900KB
// para mantener PDFs en ~300-500KB.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { LECCIONES_V2 } from "./lecciones-v2.mjs";

const require = createRequire(import.meta.url);
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  AlignmentType, PageOrientation, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, Header, Footer, PageBreak,
  HeightRule, VerticalAlign,
} = require("docx");

const NAVY="0F2847", NAVY_800="15315A", NAVY_50="F4F6FA";
const WARM="F4A261", WARM_DARK="C75B12", WHITE="FFFFFF";
const TEXT_DARK="1A1D29", TEXT_MUTED="5E6878", BORDER_SOFT="E2E8F0";

const ROOT = "C:/Users/gelfi/Desktop/b2c/materiales-premium-all";
const LOGO = fs.readFileSync("C:/Users/gelfi/Desktop/b2c/scripts/materiales/logo-small.png");

const noBorders = {top:{style:BorderStyle.NONE,size:0,color:"FFFFFF"},bottom:{style:BorderStyle.NONE,size:0,color:"FFFFFF"},left:{style:BorderStyle.NONE,size:0,color:"FFFFFF"},right:{style:BorderStyle.NONE,size:0,color:"FFFFFF"}};

function blank(s=120){return new Paragraph({spacing:{after:s},children:[new TextRun("")]});}
function eyebrow(text,color=WARM_DARK){return new Paragraph({spacing:{before:240,after:120},children:[new TextRun({text:text.toUpperCase(),bold:true,size:18,color,font:"Calibri",characterSpacing:80})]});}
function h1Serif(text,color=NAVY,size=48){return new Paragraph({spacing:{before:100,after:220},children:[new TextRun({text,bold:true,size,color,font:"Cambria"})]});}
function bodyText(text,o={}){const{size=24,color=TEXT_DARK,italics=false,bold=false,spacingAfter=120,align=AlignmentType.LEFT}=o;return new Paragraph({alignment:align,spacing:{after:spacingAfter,line:320},children:[new TextRun({text,size,color,italics,bold,font:"Calibri"})]});}

function spanishKeyBox(text){
  return new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[9360],rows:[new TableRow({children:[new TableCell({
    width:{size:9360,type:WidthType.DXA},
    shading:{fill:"FFF4E6",type:ShadingType.CLEAR},
    borders:{top:{style:BorderStyle.NONE,size:0,color:WHITE},bottom:{style:BorderStyle.NONE,size:0,color:WHITE},right:{style:BorderStyle.NONE,size:0,color:WHITE},left:{style:BorderStyle.SINGLE,size:24,color:WARM_DARK}},
    margins:{top:180,bottom:180,left:280,right:220},
    children:[
      new Paragraph({spacing:{after:80},children:[new TextRun({text:"💡  ",size:24}),new TextRun({text:"CLAVE EN ESPAÑOL",bold:true,size:18,color:WARM_DARK,font:"Calibri",characterSpacing:100})]}),
      new Paragraph({spacing:{after:60,line:320},children:[new TextRun({text,size:22,color:TEXT_DARK,font:"Calibri"})]}),
    ],
  })]})]});
}

function practiceDialogue(ip){
  const SPK=1800, TXT=7560;
  const rows=[
    new TableRow({children:[new TableCell({
      borders:noBorders,shading:{fill:NAVY,type:ShadingType.CLEAR},
      margins:{top:200,bottom:200,left:320,right:320},
      width:{size:SPK+TXT,type:WidthType.DXA},columnSpan:2,
      children:[
        new Paragraph({spacing:{after:100},children:[new TextRun({text:`🎬  ${ip.title.toUpperCase()}`,bold:true,size:20,color:WARM,font:"Calibri",characterSpacing:80})]}),
        new Paragraph({children:[new TextRun({text:ip.scenarioEs,italics:true,size:20,color:NAVY_50,font:"Calibri"})]}),
      ],
    })]}),
    ...ip.dialogue.map((line,i)=>new TableRow({children:[
      new TableCell({borders:noBorders,shading:i%2?{fill:NAVY_50,type:ShadingType.CLEAR}:undefined,margins:{top:120,bottom:120,left:320,right:120},width:{size:SPK,type:WidthType.DXA},verticalAlign:VerticalAlign.TOP,
        children:[new Paragraph({children:[new TextRun({text:line.speaker,bold:true,size:20,color:WARM_DARK,font:"Calibri",characterSpacing:40})]})]}),
      new TableCell({borders:noBorders,shading:i%2?{fill:NAVY_50,type:ShadingType.CLEAR}:undefined,margins:{top:120,bottom:120,left:100,right:320},width:{size:TXT,type:WidthType.DXA},
        children:[new Paragraph({children:[new TextRun({text:line.text,size:22,color:NAVY,font:"Cambria",italics:true})]})]}),
    ]})),
  ];
  return new Table({width:{size:SPK+TXT,type:WidthType.DXA},columnWidths:[SPK,TXT],rows});
}

function mistakesTable(items){
  const cW=9360;
  const rows=[
    new TableRow({children:[new TableCell({borders:noBorders,shading:{fill:NAVY,type:ShadingType.CLEAR},margins:{top:160,bottom:160,left:280,right:280},width:{size:cW,type:WidthType.DXA},
      children:[new Paragraph({children:[new TextRun({text:"⚠️  ERRORES COMUNES DEL HISPANOHABLANTE",bold:true,size:20,color:WARM,font:"Calibri",characterSpacing:100})]})]})]}),
    ...items.map((it,i)=>new TableRow({children:[new TableCell({borders:noBorders,shading:i%2?{fill:NAVY_50,type:ShadingType.CLEAR}:undefined,margins:{top:200,bottom:200,left:280,right:280},width:{size:cW,type:WidthType.DXA},
      children:[
        new Paragraph({spacing:{after:80,line:300},children:[new TextRun({text:"❌  ",bold:true,size:24,color:"C00000"}),new TextRun({text:it.wrong,size:22,color:"C00000",font:"Cambria",italics:true})]}),
        new Paragraph({spacing:{after:100,line:300},children:[new TextRun({text:"✅  ",bold:true,size:24,color:"1F7A1F"}),new TextRun({text:it.right,size:22,color:"1F7A1F",font:"Cambria",italics:true,bold:true})]}),
        new Paragraph({spacing:{after:0,line:300},indent:{left:480},children:[new TextRun({text:it.why,size:20,color:TEXT_MUTED,font:"Calibri"})]}),
      ],
    })]})),
  ];
  return new Table({width:{size:cW,type:WidthType.DXA},columnWidths:[cW],rows});
}

function highlightBox(title,body,examples){
  return new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[9360],rows:[new TableRow({children:[new TableCell({
    width:{size:9360,type:WidthType.DXA},
    shading:{fill:NAVY_50,type:ShadingType.CLEAR},
    borders:{top:{style:BorderStyle.NONE,size:0,color:WHITE},bottom:{style:BorderStyle.NONE,size:0,color:WHITE},right:{style:BorderStyle.NONE,size:0,color:WHITE},left:{style:BorderStyle.SINGLE,size:24,color:WARM}},
    margins:{top:200,bottom:200,left:280,right:200},
    children:[
      new Paragraph({spacing:{after:100},children:[new TextRun({text:title,bold:true,size:24,color:NAVY,font:"Cambria"})]}),
      new Paragraph({spacing:{after:160,line:320},children:[new TextRun({text:body,size:21,color:TEXT_DARK,font:"Calibri"})]}),
      ...examples.map(ex=>new Paragraph({spacing:{after:80},children:[new TextRun({text:"›  ",bold:true,size:22,color:WARM_DARK,font:"Calibri"}),new TextRun({text:ex,size:22,color:NAVY,font:"Cambria",italics:true})]})),
    ],
  })]})]});
}

function vocabTable(items){
  const cw1=5500,cw2=5500;
  const headerRow=new TableRow({tableHeader:true,height:{value:480,rule:HeightRule.ATLEAST},children:[
    new TableCell({borders:noBorders,shading:{fill:NAVY,type:ShadingType.CLEAR},margins:{top:140,bottom:140,left:200,right:200},verticalAlign:VerticalAlign.CENTER,width:{size:cw1,type:WidthType.DXA},
      children:[new Paragraph({children:[new TextRun({text:"DEUTSCH",bold:true,size:24,color:WHITE,font:"Calibri",characterSpacing:60})]})]}),
    new TableCell({borders:noBorders,shading:{fill:NAVY,type:ShadingType.CLEAR},margins:{top:140,bottom:140,left:200,right:200},verticalAlign:VerticalAlign.CENTER,width:{size:cw2,type:WidthType.DXA},
      children:[new Paragraph({children:[new TextRun({text:"ESPAÑOL",bold:true,size:24,color:WHITE,font:"Calibri",characterSpacing:60})]})]}),
  ]});
  const dataRows=items.map((it,i)=>new TableRow({height:{value:360,rule:HeightRule.ATLEAST},children:[
    new TableCell({borders:{top:{style:BorderStyle.NONE,size:0,color:WHITE},bottom:{style:BorderStyle.SINGLE,size:2,color:BORDER_SOFT},left:{style:BorderStyle.NONE,size:0,color:WHITE},right:{style:BorderStyle.NONE,size:0,color:WHITE}},shading:i%2?{fill:NAVY_50,type:ShadingType.CLEAR}:undefined,margins:{top:80,bottom:80,left:200,right:120},width:{size:cw1,type:WidthType.DXA},verticalAlign:VerticalAlign.CENTER,
      children:[new Paragraph({children:[new TextRun({text:it.de,bold:true,size:24,color:NAVY,font:"Cambria"})]})]}),
    new TableCell({borders:{top:{style:BorderStyle.NONE,size:0,color:WHITE},bottom:{style:BorderStyle.SINGLE,size:2,color:BORDER_SOFT},left:{style:BorderStyle.NONE,size:0,color:WHITE},right:{style:BorderStyle.NONE,size:0,color:WHITE}},shading:i%2?{fill:NAVY_50,type:ShadingType.CLEAR}:undefined,margins:{top:80,bottom:80,left:120,right:200},width:{size:cw2,type:WidthType.DXA},verticalAlign:VerticalAlign.CENTER,
      children:[new Paragraph({children:[new TextRun({text:it.es,size:24,color:TEXT_MUTED,font:"Calibri",italics:true})]})]}),
  ]}));
  return new Table({width:{size:cw1+cw2,type:WidthType.DXA},columnWidths:[cw1,cw2],rows:[headerRow,...dataRows]});
}

function pageHeader(L){
  return new Header({children:[new Table({width:{size:9360,type:WidthType.DXA},columnWidths:[4680,4680],borders:noBorders,rows:[new TableRow({children:[
    new TableCell({borders:noBorders,width:{size:4680,type:WidthType.DXA},margins:{top:80,bottom:80,left:0,right:0},
      children:[new Paragraph({children:[
        new ImageRun({type:"png",data:LOGO,transformation:{width:22,height:22},altText:{title:"AA",description:"L",name:"l"}}),
        new TextRun({text:"  Aprender-Aleman",bold:true,size:18,color:NAVY,font:"Calibri"}),
        new TextRun({text:".de",bold:true,size:18,color:WARM_DARK,font:"Calibri"}),
      ]})]}),
    new TableCell({borders:noBorders,width:{size:4680,type:WidthType.DXA},margins:{top:80,bottom:80,left:0,right:0},
      children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:`NIVEAU ${L.level}  ·  LEKTION ${L.n}`,size:16,color:TEXT_MUTED,font:"Calibri",characterSpacing:60,bold:true})]})]}),
  ]})]})]});
}

function pageFooter(){
  return new Footer({children:[new Paragraph({alignment:AlignmentType.CENTER,border:{top:{style:BorderStyle.SINGLE,size:4,color:BORDER_SOFT,space:6}},children:[
    new TextRun({text:"Aprender-Aleman",size:16,color:NAVY,bold:true,font:"Calibri"}),
    new TextRun({text:".de",size:16,color:WARM_DARK,bold:true,font:"Calibri"}),
    new TextRun({text:"  ·  Online-Deutschakademie  ·  Seite ",size:16,color:TEXT_MUTED,font:"Calibri"}),
    new TextRun({children:[PageNumber.CURRENT],size:16,color:TEXT_MUTED,font:"Calibri",bold:true}),
  ]})]});
}

function buildCoverSection(L){
  const PAGE_W=16838, PAGE_H=11906;
  const cell=new TableCell({borders:noBorders,shading:{fill:NAVY,type:ShadingType.CLEAR},width:{size:PAGE_W,type:WidthType.DXA},margins:{top:600,bottom:600,left:1400,right:1400},children:[
    new Paragraph({spacing:{before:800,after:200},alignment:AlignmentType.LEFT,children:[
      new ImageRun({type:"png",data:LOGO,transformation:{width:56,height:56},altText:{title:"AA",description:"L",name:"l"}}),
      new TextRun({text:"   Aprender-Aleman",bold:true,size:28,color:WHITE,font:"Calibri"}),
      new TextRun({text:".de",bold:true,size:28,color:WARM,font:"Calibri"}),
    ]}),
    new Paragraph({spacing:{after:1800},children:[new TextRun({text:"",size:24})]}),
    new Paragraph({spacing:{after:280},children:[new TextRun({text:`DEUTSCHKURS  ·  NIVEAU ${L.level}  ·  LEKTION ${L.n}`,bold:true,size:22,color:WARM,font:"Calibri",characterSpacing:200})]}),
    new Paragraph({spacing:{after:220},children:[new TextRun({text:L.title,bold:true,size:72,color:WHITE,font:"Cambria"})]}),
    new Paragraph({spacing:{after:200},children:[new TextRun({text:"Lehrerpräsentation für den Unterricht",italics:true,size:28,color:NAVY_50,font:"Cambria"})]}),
    new Paragraph({spacing:{after:1800},children:[new TextRun({text:"",size:24})]}),
    new Paragraph({spacing:{before:200,after:80},border:{top:{style:BorderStyle.SINGLE,size:8,color:WARM,space:6}},children:[new TextRun({text:" ",size:12})]}),
    new Paragraph({children:[new TextRun({text:"Online-Deutschakademie  ·  Muttersprachliche Lehrkräfte  ·  ",size:18,color:NAVY_50,font:"Calibri"}),new TextRun({text:"aprender-aleman.de",size:18,color:WARM,bold:true,font:"Calibri"})]}),
  ]});
  const coverTable=new Table({width:{size:PAGE_W,type:WidthType.DXA},columnWidths:[PAGE_W],rows:[new TableRow({height:{value:PAGE_H,rule:HeightRule.EXACT},children:[cell]})]});
  return {properties:{page:{size:{width:PAGE_W,height:PAGE_H,orientation:PageOrientation.LANDSCAPE},margin:{top:0,right:0,bottom:0,left:0}}},children:[coverTable]};
}

function contentSection(L,children){
  return {properties:{page:{size:{width:11906,height:16838,orientation:PageOrientation.LANDSCAPE},margin:{top:1200,right:1440,bottom:1080,left:1440}}},headers:{default:pageHeader(L)},footers:{default:pageFooter()},children};
}

function buildDoc(L){
  const sections=[buildCoverSection(L)];
  const content=[
    eyebrow("Lernziele dieser Lektion"),
    h1Serif("Was wirst du heute lernen?",NAVY,52), blank(200),
    ...L.learningObjectives.map((obj,i)=>new Paragraph({spacing:{after:320,line:320},children:[
      new TextRun({text:String(i+1).padStart(2,"0"),bold:true,size:56,color:WARM,font:"Cambria"}),
      new TextRun({text:"    ",size:24}),
      new TextRun({text:obj,size:28,color:TEXT_DARK,font:"Calibri"}),
    ]})),
    new Paragraph({children:[new PageBreak()]}),
    eyebrow("Wortschatz"), h1Serif("Neue Wörter dieser Lektion",NAVY,44), blank(160),
    vocabTable(L.vocabulary),
    new Paragraph({children:[new PageBreak()]}),
    eyebrow("Grammatik im Fokus"), h1Serif(L.grammar.title,NAVY,40), blank(160),
    highlightBox("Erklärung",L.grammar.explanation,L.grammar.examples),
    ...(L.grammarSpanishKey?[blank(180),spanishKeyBox(L.grammarSpanishKey)]:[]),
    new Paragraph({children:[new PageBreak()]}),
    eyebrow("Beispiele aus dem Alltag"), h1Serif("So benutzt man es wirklich",NAVY,44), blank(200),
    ...L.examples.map(ex=>new Paragraph({spacing:{after:280,line:320},border:{left:{style:BorderStyle.SINGLE,size:16,color:WARM,space:12}},indent:{left:240},
      children:[new TextRun({text:ex,size:30,color:NAVY,font:"Cambria",italics:true})]})),
    new Paragraph({children:[new PageBreak()]}),
    ...(L.inPractice?[
      eyebrow("In der Praxis"), h1Serif("Ein echter Dialog",NAVY,44), blank(160),
      practiceDialogue(L.inPractice),
      new Paragraph({children:[new PageBreak()]}),
    ]:[]),
    ...(L.commonMistakes&&L.commonMistakes.length>0?[
      eyebrow("Häufige Fehler"), h1Serif("Was Spanischsprachige oft falsch machen",NAVY,40), blank(160),
      mistakesTable(L.commonMistakes),
      new Paragraph({children:[new PageBreak()]}),
    ]:[]),
    eyebrow("Aktivität im Unterricht"), h1Serif("Lass uns das jetzt üben",NAVY,44), blank(200),
    bodyText(L.classExercise,{size:28,color:TEXT_DARK,spacingAfter:240}),
    new Paragraph({children:[new PageBreak()]}),
    eyebrow("Hausaufgabe"), h1Serif("Für die nächste Stunde",NAVY,44), blank(200),
    bodyText(L.homework,{size:28,color:TEXT_DARK,spacingAfter:240}),
    new Paragraph({children:[new PageBreak()]}),
    eyebrow("Zusammenfassung"), h1Serif("Was du jetzt kannst",NAVY,48), blank(200),
    new Paragraph({spacing:{after:200,line:360},border:{left:{style:BorderStyle.SINGLE,size:24,color:WARM,space:16}},indent:{left:320},
      children:[new TextRun({text:L.summary,size:32,color:NAVY,font:"Cambria",italics:true})]}),
    new Paragraph({children:[new PageBreak()]}),
    blank(800),
    new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:200},children:[new ImageRun({type:"png",data:LOGO,transformation:{width:80,height:80},altText:{title:"AA",description:"L",name:"l"}})]}),
    new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:200},children:[new TextRun({text:"Vielen Dank!",bold:true,size:80,color:NAVY,font:"Cambria"})]}),
    new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:320},children:[new TextRun({text:"Bis zur nächsten Stunde 👋",size:30,color:TEXT_MUTED,font:"Cambria",italics:true})]}),
    new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:800},children:[new TextRun({text:"aprender-aleman.de",bold:true,size:22,color:WARM_DARK,font:"Calibri",characterSpacing:100})]}),
  ];
  sections.push(contentSection(L,content));
  return new Document({creator:"Aprender-Aleman.de",title:`${L.level}·L${L.n}·${L.title}`,styles:{default:{document:{run:{font:"Calibri",size:22}}}},sections});
}

// Main: generar 70 DOCX
fs.mkdirSync(ROOT,{recursive:true});
let ok=0;
for(const L of LECCIONES_V2){
  const levelDir=path.join(ROOT,L.level);
  fs.mkdirSync(levelDir,{recursive:true});
  const docFile=path.join(levelDir,`${L.level}-${String(L.n).padStart(2,"0")}-${L.slug}.docx`);
  const buf=await Packer.toBuffer(buildDoc(L));
  fs.writeFileSync(docFile,buf);
  ok++;
  if(ok%10===0) console.log(`  ${ok}/70 generated`);
}
console.log(`\n✔ Generados ${ok} DOCX en ${ROOT}/`);
