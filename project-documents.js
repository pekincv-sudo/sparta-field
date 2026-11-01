(function(root,factory){"use strict";const api=factory(root);if(typeof module==="object"&&module.exports)module.exports=api;else root.SpartaProjectDocuments=api;})(typeof window!=="undefined"?window:null,function(root){
  "use strict";
  const escape=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
  const text=value=>String(value??"");
  const amount=value=>Number(value).toLocaleString("uk-UA",{minimumFractionDigits:2,maximumFractionDigits:2});
  const qty=value=>Number(value).toLocaleString("uk-UA",{maximumFractionDigits:3});
  const cents=value=>{const n=Number(value);if(!Number.isFinite(n)||n<0||!Number.isSafeInteger(Math.round(n*100)))throw Error("Перевірте кількість і суми документа.");return Math.round(n*100);};
  let active=null;
  function contractTerms(input,total){
    const source=input||{},month=(key,fallback)=>{const n=Number(source[key]??fallback);if(!Number.isSafeInteger(n)||n<1||n>1200)throw Error("Укажіть гарантійні строки в цілих місяцях.");return n;};
    const rawAdvance=source.advancePercent;if(rawAdvance==null||String(rawAdvance).trim()==="")throw Error("Укажіть аванс у відсотках для договору. Якщо аванс не потрібен, укажіть 0.");
    const advancePercent=Number(rawAdvance);if(!Number.isFinite(advancePercent)||advancePercent<0||advancePercent>100||Math.abs(advancePercent*100-Math.round(advancePercent*100))>0.00001)throw Error("Аванс має бути від 0 до 100% з точністю до двох знаків.");
    const required=(key,label)=>{const value=text(source[key]).trim();if(!value)throw Error(`Заповніть ${label} у договорі.`);return value;};
    const advanceAmount=Math.round(cents(total)*advancePercent/100)/100;
    return {installationWarrantyMonths:month("installationWarrantyMonths",12),equipmentWarrantyMonths:month("equipmentWarrantyMonths",60),advancePercent,advanceAmount,balanceAmount:(cents(total)-cents(advanceAmount))/100,
      remainingPaymentTerms:required("remainingPaymentTerms","умови остаточної оплати"),performerResponsibilities:required("performerResponsibilities","відповідальність виконавця"),customerResponsibilities:required("customerResponsibilities","відповідальність замовника"),workTerms:required("workTerms","строки та порядок виконання робіт")};
  }
  const warrantyPeriod=months=>`${months} міс.${months%12===0?` (${months/12} ${months/12===1?"рік":months/12>=2&&months/12<=4?"роки":"років"})`:""}`;
  function contractSections(value){
    const t=value.contractTerms;if(value.kind!=="contract"||!t)return [];
    return [
      {title:"1. Предмет і вартість",body:`Виконавець постачає обладнання та матеріали і виконує монтажні роботи на об’єкті замовника за комплектацією в таблиці. Загальна сума договору - ${amount(value.total)} ${value.currency}; вона дорівнює сумі обладнання, матеріалів і монтажних робіт за комерційною пропозицією.`},
      {title:"2. Умови оплати",body:`Аванс - ${qty(t.advancePercent)}%: ${amount(t.advanceAmount)} ${value.currency}. Залишок після авансу - ${amount(t.balanceAmount)} ${value.currency}. ${t.remainingPaymentTerms}`},
      {title:"3. Строки та порядок виконання",body:t.workTerms},
      {title:"4. Гарантії",body:`Гарантія виконавця на монтажні роботи - ${warrantyPeriod(t.installationWarrantyMonths)} з дати підтвердженого завершення монтажу. Гарантія виробника на обладнання - ${warrantyPeriod(t.equipmentWarrantyMonths)} відповідно до гарантійної документації виробника; початок строку та порядок звернення визначаються нею. Обов’язкові гарантії та права замовника, передбачені законом, діють незалежно від зазначених строків.`},
      {title:"5. Обов’язки та відповідальність виконавця",body:t.performerResponsibilities},
      {title:"6. Обов’язки та відповідальність замовника",body:t.customerResponsibilities}
    ];
  }
  function model(input){
    const currency=input.currency||"USD";if(!["USD","UAH"].includes(currency))throw Error("Перевірте валюту документа.");
    const rows=(input.rows||[]).map(row=>{const n=Number(row.qty),p=Number(row.price);if(!Number.isFinite(n)||n<=0)throw Error("Перевірте кількість обладнання.");cents(p);if(Math.abs(p*100-Math.round(p*100))>0.00001)throw Error("Укажіть ціни з точністю до двох знаків після коми.");if(!text(row.name).trim())throw Error("Заповніть назву обладнання.");return {name:text(row.name),note:text(row.note),unit:text(row.unit||"шт"),qty:n,price:p,amount:cents(n*p)/100};});
    if(!rows.length)throw Error("Спочатку додайте обладнання або матеріали до КП.");
    const installation=cents(input.installation)/100;
    const totalMinor=rows.reduce((sum,row)=>sum+cents(row.amount),cents(installation));
    if(!Number.isSafeInteger(totalMinor))throw Error("Сума документа завелика.");
    const contract=input.kind==="contract",terms=contract?contractTerms(input.contractTerms,totalMinor/100):null;
    return {kind:contract?"contract":"offer",title:contract?"Проєкт договору":"Комерційна пропозиція",project:text(input.project),currency,
      client:text(input.client),phone:text(input.phone),address:text(input.address),number:contract?text(input.number):"",date:text(input.date),
      company:{name:text(input.company?.name),phone:text(input.company?.phone),email:text(input.company?.email),address:text(input.company?.address)},
      rows,installation,total:totalMinor/100,agreed:contract?totalMinor/100:null,contractTerms:terms};
  }
  function sheet(value){
    const e=escape;
    return `<article class="pdoc-sheet"><header class="pdoc-brand"><div><b>SPARTA <span>POWER</span></b><p>${e(value.company.name)}</p></div><div><h2>${e(value.title)}</h2><p>${value.number?`№ ${e(value.number)} · `:""}${e(value.date)}</p></div></header><h3>${e(value.project)}</h3><dl class="pdoc-client"><div><dt>Клієнт</dt><dd>${e(value.client||"Не вказано")}</dd></div><div><dt>Телефон</dt><dd>${e(value.phone||"Не вказано")}</dd></div><div class="pdoc-full"><dt>Адреса об’єкта</dt><dd>${e(value.address||"Не вказано")}</dd></div></dl><p class="pdoc-currency">Усі ціни та суми: ${e(value.currency)}</p><table class="pdoc-table"><thead><tr><th>Назва товару / матеріалу</th><th>К-сть</th><th>Ціна</th><th>Сума</th></tr></thead><tbody>${value.rows.map(row=>`<tr><td><strong>${e(row.name)}</strong>${row.note?`<small>${e(row.note)}</small>`:""}</td><td>${qty(row.qty)}<small>${e(row.unit)}</small></td><td>${amount(row.price)}</td><td>${amount(row.amount)}</td></tr>`).join("")}<tr><td colspan="3">Монтажні роботи</td><td>${amount(value.installation)}</td></tr></tbody><tfoot><tr><th colspan="3">Разом${value.kind==="contract"?" за КП":""}, ${e(value.currency)}</th><td>${amount(value.total)}</td></tr>${value.agreed!=null?`<tr><th colspan="3">Сума договору, ${e(value.currency)}</th><td>${amount(value.agreed)}</td></tr>`:""}</tfoot></table>${value.kind==="contract"?`<section class="pdoc-terms" aria-label="Умови договору">${contractSections(value).map(section=>`<section><h4>${e(section.title)}</h4><p>${e(section.body)}</p></section>`).join("")}</section><p class="pdoc-note">Проєкт для погодження. Умови, строки й реквізити сторін підлягають перевірці перед підписанням. Цей документ не підтверджує оплату або списання обладнання зі складу.</p>`:`<p class="pdoc-note">Попередня вартість обладнання та робіт. Остаточні комплектація, ціна й умови постачання погоджуються окремо. Пропозиція не є рахунком на оплату.</p>`}<footer class="pdoc-company"><strong>${e(value.company.name)}</strong><span>${e(value.company.address)}</span><span>${e(value.company.phone)} · ${e(value.company.email)}</span></footer></article>`;
  }
  function pdfBytes(images){
    const encoder=new TextEncoder(),parts=[],offsets=[0];let size=0;
    const add=value=>{const bytes=typeof value==="string"?encoder.encode(value):value;parts.push(bytes);size+=bytes.length;};
    const object=(id,content)=>{offsets[id]=size;add(`${id} 0 obj\n`);content();add("\nendobj\n");};
    add("%PDF-1.4\n%SPARTA\n");object(1,()=>add("<< /Type /Catalog /Pages 2 0 R >>"));
    object(2,()=>add(`<< /Type /Pages /Count ${images.length} /Kids [${images.map((_,i)=>`${3+i*3} 0 R`).join(" ")}] >>`));
    images.forEach((image,i)=>{const page=3+i*3,img=page+1,stream=page+2;
      object(page,()=>add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${stream} 0 R >>`));
      object(img,()=>{add(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`);add(image.bytes);add("\nendstream");});
      const commands="q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n";
      object(stream,()=>add(`<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}endstream`));
    });
    const xref=size;add(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);offsets.slice(1).forEach(offset=>add(`${String(offset).padStart(10,"0")} 00000 n \n`));add(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const result=new Uint8Array(size);let at=0;parts.forEach(bytes=>{result.set(bytes,at);at+=bytes.length;});return result;
  }
  function wrap(ctx,value,width){
    const lines=[];for(const paragraph of text(value).split(/\r?\n/)){let line="";for(const word of paragraph.split(/\s+/)){if(ctx.measureText(word).width<=width){if(line&&ctx.measureText(line+" "+word).width>width){lines.push(line);line=word;}else line+=(line?" ":"")+word;}else{if(line){lines.push(line);line="";}for(const char of Array.from(word)){if(line&&ctx.measureText(line+char).width>width){lines.push(line);line=char;}else line+=char;}}}lines.push(line);}return lines;
  }
  async function pdf(value){
    const pages=[],W=1190,H=1684,L=82,R=1108,B=1500,columns=[L,650,780,945,R];let ctx,y;
    const font=(size=22,bold=false)=>{ctx.font=`${bold?"700":"400"} ${size}px Arial, sans-serif`;ctx.fillStyle="#15252d";ctx.textAlign="left";};
    const line=(content,x,baseline,width=R-L,size=22,bold=false)=>{font(size,bold);const lines=wrap(ctx,content,width);for(const item of lines){ctx.fillText(item,x,baseline);baseline+=size*1.4;}return baseline;};
    const tableHead=()=>{ctx.fillStyle="#15252d";ctx.fillRect(L,y,R-L,48);font(20,true);ctx.fillStyle="#ffffff";["Назва товару / матеріалу","Кількість","Ціна","Сума"].forEach((label,i)=>ctx.fillText(label,columns[i]+12,y+31));y+=48;};
    const page=(first,withTable=true)=>{const canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;ctx=canvas.getContext("2d");if(!ctx)throw Error("Не вдалося сформувати PDF на цьому пристрої.");ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);pages.push(canvas);line("SPARTA POWER",L,91,R-L,34,true);ctx.fillStyle="#ffd21a";ctx.fillRect(L,110,R-L,7);y=line(value.title,L,160,R-L,30,true);y=line(`${value.number?"№ "+value.number+" · ":""}${value.date} · ${value.currency}`,L,y+4,R-L,20);y=line(value.project,L,y+12,R-L,22,true);
      if(first){y=line(`Клієнт: ${value.client||"Не вказано"}`,L,y+12,R-L,22);y=line(`Телефон: ${value.phone||"Не вказано"}`,L,y,R-L,22);y=line(`Адреса: ${value.address||"Не вказано"}`,L,y,R-L,22);}y+=14;if(withTable)tableHead();};
    page(true);
    for(const row of value.rows){font(22,true);const lines=wrap(ctx,row.name,columns[1]-L-28);if(row.note){font(22);lines.push(...wrap(ctx,row.note,columns[1]-L-28));}font(20);const numeric=[`${qty(row.qty)} ${row.unit}`,amount(row.price),amount(row.amount)].map((v,i)=>wrap(ctx,v,columns[i+2]-columns[i+1]-24));const numericHeight=Math.max(...numeric.map(v=>v.length))*27+24;let at=0;
      while(at<lines.length){if(B-y<Math.max(84,at===0?numericHeight:0))page(false);const count=Math.min(lines.length-at,Math.max(1,Math.floor((B-y-24)/30))),height=Math.max(70,count*30+24,at===0?numericHeight:0);ctx.fillStyle="#f2f5f6";ctx.fillRect(L,y,R-L,height);font(22);for(let n=0;n<count;n++)ctx.fillText(lines[at+n],L+12,y+31+n*30);if(at===0){numeric.forEach((v,i)=>{font(20,i===2);v.forEach((t,n)=>ctx.fillText(t,columns[i+1]+12,y+31+n*27));});}ctx.strokeStyle="#d7e0e3";ctx.beginPath();ctx.moveTo(L,y+height);ctx.lineTo(R,y+height);ctx.stroke();y+=height;at+=count;if(at<lines.length)page(false);}
    }
    if(B-y<350)page(false);y+=24;line("Монтажні роботи",L+12,y+28,650,22);line(`${amount(value.installation)} ${value.currency}`,800,y+28,308,22,true);y+=65;ctx.fillStyle="#fff4bd";ctx.fillRect(L,y,R-L,62);line(value.kind==="contract"?"Разом за КП":"Разом",L+12,y+40,600,25,true);line(`${amount(value.total)} ${value.currency}`,800,y+40,308,25,true);y+=92;
    if(value.agreed!=null){y=line(`Сума договору: ${amount(value.agreed)} ${value.currency}`,L,y,R-L,25,true);y+=14;}
    const paragraph=(content,size=20,bold=false)=>{font(size,bold);const lines=wrap(ctx,content,R-L);for(const item of lines){if(y+size*1.4>B)page(false,false);font(size,bold);ctx.fillText(item,L,y+size);y+=size*1.4;}y+=12;};
    if(value.kind==="contract")for(const section of contractSections(value)){if(B-y<110)page(false,false);paragraph(section.title,22,true);paragraph(section.body);y+=6;}
    const note=value.kind==="contract"?"Проєкт для погодження. Умови, строки й реквізити сторін перевіряють перед підписанням. Документ не підтверджує оплату або списання обладнання зі складу.":"Попередня оцінка обладнання та робіт. Остаточні комплектація, ціна й умови постачання погоджуються окремо. Не є рахунком на оплату.";
    paragraph(note);y+=8;paragraph([value.company.name,value.company.address,value.company.phone,value.company.email].filter(Boolean).join(" · "),19);
    const images=[];for(let i=0;i<pages.length;i++){const canvas=pages[i];ctx=canvas.getContext("2d");font(18);ctx.fillStyle="#62747b";ctx.fillText(`SPARTA POWER · ${i+1} / ${pages.length}`,L,H-65);const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.94));if(!blob)throw Error("Не вдалося сформувати сторінку PDF.");images.push({width:W,height:H,bytes:new Uint8Array(await blob.arrayBuffer())});canvas.width=1;canvas.height=1;}return new Blob([pdfBytes(images)],{type:"application/pdf"});
  }
  function filename(value){return `${value.kind==="contract"?"Договір-проєкт":"КП"}-${value.project}`.replace(/[<>:"/\\|?*\x00-\x1f]/g,"-").slice(0,110)+".pdf";}
  function reset(){const old=active;active=null;if(old){old.urls.forEach(url=>URL.revokeObjectURL(url));if(old.dialog.open)old.dialog.close();old.dialog.remove();}}
  function valid(value){if(active!==value)return false;if(value.allowed&&!value.allowed()){reset();return false;}return true;}
  function download(value){if(!valid(value)||!value.file)return;const url=URL.createObjectURL(value.file);value.urls.push(url);const a=document.createElement("a");a.href=url;a.download=value.file.name;a.click();value.status.textContent="PDF завантажено. Його можна прикріпити до листа або повідомлення клієнту.";}
  async function open(input,{allowed}={}){
    reset();const data=model(input);if(allowed&&!allowed())throw Error("Доступ або об’єкт змінився. Відкрийте документ заново.");const dialog=document.createElement("dialog");dialog.className="pdoc-dialog";dialog.setAttribute("aria-label",`Попередній перегляд: ${data.title}`);dialog.innerHTML=`<div class="pdoc-shell"><header class="pdoc-toolbar"><div><strong>Попередній перегляд</strong><small>Перевірте клієнта, комплектацію та суми перед надсиланням.</small></div><button type="button" data-pdoc-close aria-label="Закрити попередній перегляд">×</button></header><div class="pdoc-body">${sheet(data)}</div><footer class="pdoc-actions"><p role="status" aria-live="polite">Готуємо PDF…</p><button type="button" data-pdoc-download disabled>Завантажити PDF</button><button type="button" data-pdoc-share disabled>Надіслати клієнту</button></footer></div>`;document.body.append(dialog);const value={dialog,data,allowed,file:null,urls:[],status:dialog.querySelector('[role="status"]')};active=value;
    dialog.addEventListener("cancel",event=>{event.preventDefault();reset();});dialog.querySelector('[data-pdoc-close]').onclick=reset;
    dialog.querySelector('[data-pdoc-download]').onclick=()=>download(value);
    dialog.querySelector('[data-pdoc-share]').onclick=async()=>{if(!valid(value)||!value.file)return;try{if(root.navigator.share&&root.navigator.canShare?.({files:[value.file]})){await root.navigator.share({files:[value.file],title:data.title});if(valid(value))value.status.textContent="PDF передано у вибраний застосунок для надсилання.";}else download(value);}catch(error){if(valid(value)&&error.name!=="AbortError")value.status.textContent="Не вдалося відкрити надсилання. Завантажте PDF і прикріпіть його до повідомлення клієнту.";}};
    dialog.showModal();try{const blob=await pdf(data);if(!valid(value))return;value.file=new File([blob],filename(data),{type:"application/pdf"});dialog.querySelectorAll('[data-pdoc-download],[data-pdoc-share]').forEach(button=>button.disabled=false);value.status.textContent="PDF готовий. Оберіть завантаження або спосіб надсилання.";}catch(error){if(valid(value))value.status.textContent=error.message;}
  }
  return {model,sheet,pdfBytes,pdf,filename,open,reset};
});
