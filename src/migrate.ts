import {
  db,
  PACKAGE_NAME,
  Page,
  PagePreview,
  Submodule,
  Version,
  VersionPreview,
} from '@date-fns/date-fns-db'
import * as admin from 'firebase-admin'
import 'firebase/firestore'
import { stringify } from 'json-bond'
import { add, batch, id } from 'typesaurus'
import { getPageSubmodules } from './utils/getPageSubmodules'

if (process.env.RUN_SCRIPT) {
  migrate()
}

export async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.log('Please provide DATABASE_URL environment variable')
    process.exit(1)
  }

  admin.initializeApp({
    databaseURL: process.env.DATABASE_URL,
  })

  const allVersionsSnapshot = await admin
    .database()
    .ref('versions')
    .once('value')

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

      const categoriesSnapshot = await admin
        .database()
        .ref(`/docs/${versionValue.docsKey}/categories`)
        .once('value')
      const categoriesValue = categoriesSnapshot.val()

      const versionPreview: VersionPreview = {
        version: versionTag,
        preRelease: versionValue.prerelease,
        createdAt: versionValue.date,
        submodules: versionValue.features.fp
          ? [Submodule.Default, Submodule.FP]
          : [Submodule.Default],
      }

      const version: Version = {
        ...versionPreview,
        package: PACKAGE_NAME,
        pages: [],
        categories: categoriesValue,
      }

      const versionPages: Page[] = []

      const versionPagesSnapshot = await admin
        .database()
        .ref(`/docs/${versionValue.docsKey}/pages`)
        .once('value')

      versionPagesSnapshot.forEach((pageSnapshot) => {
        const pageValue = pageSnapshot.val()

        if (pageValue.type === 'markdown') {
          const pagePreview = {
            submodules: getPageSubmodules(
              versionValue.features.fp,
              pageValue.type
            ),
            slug: pageValue.urlId.replace(/\s/g, '-'),
            category: pageValue.category,
            title: pageValue.title,
            summary: pageValue.description,
          }

          const page: Page = {
            ...pagePreview,
            package: PACKAGE_NAME,
            version: versionTag,
            type: 'markdown',
            markdown: pageValue.content,
          }

          version.pages.push(pagePreview)
          versionPages.push(page)
        } else if (pageValue.type === 'jsdoc') {
          const pagePreview: PagePreview = {
            submodules: getPageSubmodules(
              versionValue.features.fp,
              pageValue.type,
              pageValue.kind,
              pageValue.isFPFn
            ),
            slug: pageValue.urlId.replace(/\s/g, '-').replace(/^fp\//, ''),
            category: pageValue.category,
            title: pageValue.title,
            summary: pageValue.description,
          }

          const page: Page = {
            ...pagePreview,
            package: PACKAGE_NAME,
            version: versionTag,
            type: 'jsdoc',
            name: pageValue.content.name,
            doc: stringify(pageValue),
          }

          version.pages.push(pagePreview)
          versionPages.push(page)
        } else {
          throw new Error(`Unknown page type ${pageValue.type}`)
        }
      })

      versionPreviews.push(versionPreview)

      const migrateBatch = batch()

      migrateBatch.set(db.versions, await id(), version)
      await Promise.all(
        versionPages.map((page) =>
          id().then((pageId) => migrateBatch.set(db.pages, pageId, page))
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
    versions: versionPreviews,
  })

  console.log('(ﾉ◕ヮ◕)ﾉ*:·ﾟ✧ Done!')
  process.exit()
}
