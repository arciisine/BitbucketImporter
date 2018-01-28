async function BambooMigrateRepos(newRepos) {
  const SECTION = document.querySelector('section.aui-page-panel-content');
  const LIST_WRAPPER = SECTION.querySelector('#panel-editor-list');
  const FORM_WRAPPER = SECTION.querySelector('#panel-editor-config');
  const ADD_REPO = LIST_WRAPPER.querySelector('#addRepository');

  function pending(x) {
    x = `${x||''}`;
    return x.trim().indexOf('[OLD]') !== 0 && x.indexOf('[BC]') < 0;
  }

  let wait = x => new Promise(r => setTimeout(r, x));

  //Cleanup Existing
  for (let item of LIST_WRAPPER.querySelectorAll('li')) {
    let title = item.querySelector('.item-title');

    if (!title || !title.innerText) {
      continue;
    }

    if (title.innerText.indexOf('[BC]') >= 0) {
      let delBtn = item.querySelector('.delete');
      delBtn.click();
      await wait(1000);
      document.querySelector('#deleteLinkedRepository_save').click();
      await wait(1000);

    } else if (title.innerText.indexOf('[OLD]') < 0) {
      item.click();
      await wait(2000);

      /**
       * @type HTMLFormElement
       */
      let form = FORM_WRAPPER.querySelector('form');
      let nameField = form.querySelector('#repositoryName');

      if (pending(('' + nameField.value))) {
        nameField.value = `[OLD] ${nameField.value}`;
        form.querySelector('#updateLinkedRepository_save').click();
        await wait(3000);
      }
    }
  }

  // Create new repos
  for (let repo of (newRepos || [])) {
    ADD_REPO.click();
    await wait(1000);

    let dialog = document.querySelector('#repository-types-dialog');
    let catBtn;

    for (let btn of dialog.querySelectorAll('.repository-type-category-new')) {
      if (btn.innerText.indexOf('Bitbucket Cloud') >= 0) {
        catBtn = btn;
        break;
      }
    }

    if (!catBtn) {
      break;
    }

    catBtn.click();
    await wait(1000);

    let form = FORM_WRAPPER.querySelector('form');
    form.querySelector('#repositoryName').value = repo.name.trim() + ' [BC]';

    let passwordCreds = form.querySelector('#createLinkedRepository_repository_bitbucket_passwordSharedCredentials_id');
    passwordCreds.value = '24969220';

    /**
     * @type HTMLSelectElement
     */
    let repoSelect = form.querySelector('#createLinkedRepository_repository_bitbucket_repository');

    if (repoSelect.options.length === 0) {
      form.querySelector('#repository-bitbucket-load-repositories').click();
      await wait(2000);
    }
    repoSelect.value = repo.path;

    let credSelect = form.querySelector('#createLinkedRepository_repository_bitbucket_sshSharedCredentials_id');
    credSelect.value = '24969217';

    form.querySelector('#test-connection-com-atlassian-bamboo-plugins-atlassian-bamboo-plugin-bitbucket-bbCloud').click();
    await wait(2000);

    form.querySelector('#createLinkedRepository_save').click();
  }
}