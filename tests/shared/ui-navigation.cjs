// Exercise the visible navigation: phone workouts expose it through Menu.
async function navigate(page,view){
  const nav=page.locator('.nav-btn[data-view="'+view+'"]');
  if(await nav.isVisible()){await nav.click();return;}
  const label=await nav.locator('.nav-label').textContent();
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await page.getByRole('dialog',{name:'Workout menu'}).getByRole('button',{name:label,exact:true}).click();
}
module.exports={navigate};
