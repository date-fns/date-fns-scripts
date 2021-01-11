import * as admin from 'firebase-admin'
import { db, VersionPreview, Version, PagePreview, Page, PACKAGE_NAME, Submodule, SUBMODULES } from '@date-fns/date-fns-db'
import { stringify } from 'json-bond'
import 'firebase/firestore'
import { batch, id, add } from 'typesaurus'

if (process.env.RUN_SCRIPT) {
  migrate()
}

export async function migrate () {
  if (!process.env.SERVICE_ACCOUNT_KEY) {
    console.log('Please provide SERVICE_ACCOUNT_KEY environment variable')
    process.exit(1)
  }
  
  if (!process.env.DATABASE_URL) {
    console.log('Please provide DATABASE_URL environment variable')
    process.exit(1)
  }
  
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.SERVICE_ACCOUNT_KEY)),
    databaseURL: process.env.DATABASE_URL
  })

  const allVersionsSnapshot = await admin.database().ref('versions').once('value')

  const versionPreviews: VersionPreview[] = []
  const migrateVersionFns: Array<() => Promise<void>> = []

  allVersionsSnapshot.forEach((versionSnapshot) => {
    const versionValue = versionSnapshot.val()
    if (!versionValue.docsKey) {
      // Skip adding version if it has no pages
      return
    }

    migrateVersionFns.push(async function () {
      const versionTag = versionValue.tag
      console.log(`Migrating ${versionTag}...`)

      const categoriesSnapshot = await admin.database().ref(`/docs/${versionValue.docsKey}/categories`).once('value')
      const categoriesValue = categoriesSnapshot.val()

      const version: Version = {
        package: PACKAGE_NAME,
        version: versionTag,
        preRelease: versionValue.prerelease,
        createdAt: versionValue.date,
        pages: [],
        categories: categoriesValue
      }

      const versionPreview: VersionPreview = {
        version: versionTag,
        preRelease: versionValue.prerelease,
        createdAt: versionValue.date
      }

      const versionPages: Page[] = []

      const versionPagesSnapshot = await admin.database().ref(`/docs/${versionValue.docsKey}/pages`).once('value')
      
      versionPagesSnapshot.forEach(pageSnapshot => {
        const pageValue = pageSnapshot.val()
        const pagePreview: Omit<PagePreview, 'submodules'> = {
          slug: pageValue.urlId.replace(/\s/g, '-'),
          category: pageValue.category,
          title: pageValue.title,
          summary: pageValue.description,
        }

        if (pageValue.type === 'markdown') {
          const submodules: Submodule[] = SUBMODULES
          const page: Page = {
            submodules,
            slug: pageValue.urlId.replace(/\s/g, '-'),
            category: pageValue.category,
            title: pageValue.title,
            summary: pageValue.description,
            package: PACKAGE_NAME,
            version: versionTag,
            type: 'markdown',
            markdown: pageValue.content
          }
          versionPages.push(page)
          version.pages.push({
            ...pagePreview,
            submodules,
          })
        } else if (pageValue.type === 'jsdoc') {
          const submodules: Submodule[] =
            pageValue.kind === 'typedef'
              ? SUBMODULES
              : [pageValue.isFPFn ? Submodule.FP : Submodule.Default]
          const page: Page = {
            submodules,
            slug: pageValue.urlId.replace(/\s/g, '-'),
            category: pageValue.category,
            title: pageValue.title,
            summary: pageValue.description,
            package: PACKAGE_NAME,
            version: versionTag,
            type: 'migrated',
            name: pageValue.content.name,
            doc: stringify(pageValue)
          }

          version.pages.push({
            ...pagePreview,
            submodules,
          })

          versionPages.push(page)
        } else {
          throw new Error(`Unknown page type ${pageValue.type}`)
        }
      })

      versionPreviews.push(versionPreview)
    
      const migrateBatch = batch()

      migrateBatch.set(db.versions, await id(), version)
      await Promise.all(
        versionPages.map(page =>
          id().then(pageId => migrateBatch.set(db.pages, pageId, page))
        )
      )

      return migrateBatch.commit()
    })
  })

  // Migrate each version sequentially
  for (const migrateVersionFn of migrateVersionFns) {
    await migrateVersionFn()
  }

  await add(db.packages, {
    name: PACKAGE_NAME,
    versions: versionPreviews
  })

  console.log('(ﾉ◕ヮ◕)ﾉ*:·ﾟ✧ Done!')
  process.exit()
}
