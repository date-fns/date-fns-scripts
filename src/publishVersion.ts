import * as admin from 'firebase-admin'
import 'firebase/firestore'
import { stringify } from 'json-bond'
import { batch, id, query, where } from 'typesaurus'
import {
  db,
  VersionPreview,
  Version,
  PagePreview,
  Page,
  PACKAGE_NAME,
  Submodule,
  JSDocFunction,
} from '@date-fns/date-fns-db'
import { getPageSubmodules } from './utils/getPageSubmodules'

interface MarkdownDoc {
  type: 'markdown'
  content: string
  description: string
  title: string
  category: string
  urlId: string
}

interface VersionData {
  tag: string
  date: number
  prerelease: boolean
  commit: string
  docsCategories: string[]
  docsPages: Array<JSDocFunction | MarkdownDoc>
}

const SECOND_BATCH_START_INDEX = 200

export async function publishVersion(data: VersionData) {
  admin.initializeApp()

  const versionPreview: VersionPreview = {
    version: data.tag,
    preRelease: data.prerelease,
    createdAt: data.date,
    submodules: [Submodule.Default, Submodule.FP],
  }

  const version: Version = {
    ...versionPreview,
    package: PACKAGE_NAME,
    pages: [],
    categories: data.docsCategories,
  }

  const versionPages: Page[] = []

  data.docsPages.forEach((docPage) => {
    if (docPage.type === 'markdown') {
      const pagePreview = {
        submodules: [Submodule.Default, Submodule.FP],
        slug: docPage.urlId.replace(/\s/g, '-'),
        category: docPage.category,
        title: docPage.title,
        summary: docPage.description,
      }

      const page: Page = {
        ...pagePreview,
        package: PACKAGE_NAME,
        version: data.tag,
        type: 'markdown',
        markdown: docPage.content,
      }

      version.pages.push(pagePreview)
      versionPages.push(page)
    } else if (docPage.type === 'jsdoc') {
      const pagePreview: PagePreview = {
        submodules: getPageSubmodules(
          true,
          docPage.type,
          docPage.kind,
          docPage.isFPFn
        ),
        slug: docPage.urlId.replace(/\s/g, '-').replace(/^fp\//, ''),
        category: docPage.category,
        title: docPage.title,
        summary: docPage.description,
      }

      const page: Page = {
        ...pagePreview,
        package: PACKAGE_NAME,
        version: data.tag,
        type: 'jsdoc',
        name: docPage.content.name,
        doc: stringify(docPage),
      }

      version.pages.push(pagePreview)
      versionPages.push(page)
    }
  })

  const dateFns = (
    await query(db.packages, [where('name', '==', PACKAGE_NAME)])
  )[0]
  if (!dateFns) {
    throw new Error('Could not find date-fns package in storage')
  }

  const publishBatch1 = batch()
  publishBatch1.update(db.packages, dateFns.ref.id, {
    versions: [...dateFns.data.versions, versionPreview],
  })
  publishBatch1.set(db.versions, await id(), version)
  await Promise.all(
    versionPages
      .slice(0, SECOND_BATCH_START_INDEX)
      .map((page) =>
        id().then((pageId) => publishBatch1.set(db.pages, pageId, page))
      )
  )
  await publishBatch1.commit()

  const publishBatch2 = batch()
  await Promise.all(
    versionPages
      .slice(SECOND_BATCH_START_INDEX)
      .map((page) =>
        id().then((pageId) => publishBatch2.set(db.pages, pageId, page))
      )
  )
  await publishBatch2.commit()
}
