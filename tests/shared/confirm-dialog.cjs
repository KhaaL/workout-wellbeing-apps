// Exercise the same visible confirmation UI in either app.
async function confirmAction(page,action,accept=true){
  await action();
  const buttons=page.locator('#dlg[open] #dlg-actions button');
  await (accept?buttons.last():buttons.first()).click();
  await page.locator('#dlg').waitFor({state:'hidden'});
}
module.exports={confirmAction};
