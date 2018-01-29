async function BambooMigrateRepos(passCredId, sshCredId, newRepos) {
  const SECTION = document.querySelector('section.aui-page-panel-content');
  const LIST_WRAPPER = SECTION.querySelector('#panel-editor-list');
  const FORM_WRAPPER = SECTION.querySelector('#panel-editor-config');

  function pending(x) {
    x = `${x||''}`;
    return x.trim().indexOf('[OLD]') !== 0 && x.indexOf('[BC]') < 0;
  }

  function setField(qry, val) {
    jQuery(qry).val(val);
    jQuery(qry).trigger('change');
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
        setField(nameField, `[OLD] ${nameField.value}`);
        $('#updateLinkedRepository_save').click();
        await wait(3000);
      }
    }
  }

  // Create new repos
  for (let repo of (newRepos || [])) {
    try {
      jQuery('#addRepository').click();
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

      console.log('Processing', repo);

      setField('#repositoryName', '[BC] ' + repo.name.trim());
      setField('#createLinkedRepository_repository_bitbucket_passwordSharedCredentials_id', passCredId);

      let repoSelect = document.querySelector('#createLinkedRepository_repository_bitbucket_repository');

      if (repoSelect.options.length === 0) {
        jQuery('#repository-bitbucket-load-repositories').click();
        console.log('Loading repos');
        await wait(2000);
      }

      setField(repoSelect, repo.path);

      console.log('Set Repo');

      setField('#createLinkedRepository_repository_bitbucket_sshSharedCredentials_id', sshCredId);
      console.log('Set SSH Cred Id');

      jQuery('#test-connection-com-atlassian-bamboo-plugins-atlassian-bamboo-plugin-bitbucket-bbCloud').click();

      await wait(2000);
      console.log('Test SSH Connection');

      if (repo.branch) {
        setField('#createLinkedRepository_repository_stash_branch', repo.branch);
        console.log('Set branch');
      }

      jQuery('#createLinkedRepository_save').click();

      await wait(3000);
    } catch (e) {
      await wait(2000);
      console.error('Failed to create', e, repo);
    }
  }
}