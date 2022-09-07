import _ from "lodash";
import * as v from "@badrap/valita";
import { ok, err, fromThrowable, Result } from "neverthrow";
import type {
  NotePropsByIdDict,
  DuplicateNoteBehavior,
  DNodePointer,
} from "./types";
import type { Option } from "./utils";
import { PublishUtils, do_ } from "./utils";
import { parse } from "./parse";
import { DendronError, assertUnreachable } from "./error";
import type { DendronResult } from './error'
import { ERROR_STATUS } from "./constants";

const noteLiteral = v.literal("note");
const autogeneratedLiteral = v.literal("autogenerated");
const categoryLiteral = v.literal("category");

const idSchema = v.string();

const sidebarItemNote = v.object({
  type: noteLiteral,
  id: idSchema,
  label: v.string(),
});

const sidebarItemAutogenerated = v.object({
  type: autogeneratedLiteral,
  id: idSchema,
});

const sidebarItemCategoryLinkNote = v.object({
  type: noteLiteral,
  id: idSchema,
});

const sidebarItemCategoryLink = v.union(sidebarItemCategoryLinkNote);

type SidebarItemCategoryConfig = {
  type: "category";
  label: string;
  items: SidebarItemConfig[];
  link: SidebarItemCategoryLink;
};
const sidebarItemCategoryConfig: v.Type<SidebarItemCategoryConfig> = v.lazy(
  () =>
    v
      .object({
        type: categoryLiteral,
        label: v.string(),
        items: v.array(v.lazy(() => sidebarItemConfig)),
        link: sidebarItemCategoryLink,
      })
      .chain((item) => {
        // error when this item is invalid and therefore won't show up in the sidebar
        if (item.items.length === 0 && !item.link) {
          return v.err(
            `Sidebar category '${item.label}' has neither any subitem nor a link. This makes this item not able to link to anything.`
          );
        }
        return v.ok(item);
      })
);

const sidebarItemCategory: v.Type<SidebarItemCategory> = v.lazy(() =>
  v.object({
    type: categoryLiteral,
    label: v.string(),
    items: v.array(v.lazy(() => sidebarItem)),
    link: sidebarItemCategoryLink,
  })
);

const sidebarItemConfig = v.union(
  sidebarItemCategoryConfig,
  sidebarItemNote,
  sidebarItemAutogenerated
);
const sidebarConfig = v.array(sidebarItemConfig);
const sidebarsConfig = v.record(sidebarConfig);

const sidebarItem = v.union(sidebarItemCategory, sidebarItemNote);

type SidebarItemConfig = v.Infer<typeof sidebarItemConfig>;
type SidebarConfig = v.Infer<typeof sidebarConfig>;
type SidebarsConfig = v.Infer<typeof sidebarsConfig>;

type SidebarItemNote = v.Infer<typeof sidebarItemNote>;
type SidebarItemAutogenerated = v.Infer<typeof sidebarItemAutogenerated>;
type SidebarItemCategoryLink = v.Infer<typeof sidebarItemCategoryLink>;
type SidebarItemCategory = {
  type: "category";
  label: string;
  items: SidebarItem[];
  link: SidebarItemCategoryLink;
};
export type SidebarItem = v.Infer<typeof sidebarItem>;
export type Sidebar = Array<SidebarItem>;
export type Sidebars = Record<string, Sidebar>;

type SidebarItemsGeneratorParams = {
  item: SidebarItemAutogenerated;
  notes: NotePropsByIdDict;
};
type SidebarItemsGenerator = (
  params: SidebarItemsGeneratorParams
) => SidebarItem[];

type SidebarOptions = {
  duplicateNoteBehavior?: DuplicateNoteBehavior;
  notes: NotePropsByIdDict;
};

type WithPosition<T> = T & {
  position?: number;
  fname?: string;
  reverse?: boolean;
};

const ROOT_KEYWORD = "*";

export const DefaultSidebars: SidebarsConfig = {
  defaultSidebar: [
    {
      type: "autogenerated",
      id: ROOT_KEYWORD,
    },
  ],
};

export const DisabledSidebars: SidebarsConfig = {};

const defaultSidebarItemsGenerator: SidebarItemsGenerator = ({
  item,
  notes: notesById,
}) => {
  function findHierarchySources() {
    const isTopLevel = item.id === ROOT_KEYWORD;

    // 1. if item-pointer to root find all root notes
    if (isTopLevel) {
      return Object.values(notesById)
        .filter((note) => {
          const { fname } = note;
          if (fname === "root") {
            return false;
          }
          const hierarchyPath = fname.split(".");
          if (hierarchyPath.length === 1) {
            return true;
          }
          return false;
        })
        .map(({ id }) => id);
    }

    const note = notesById[item.id];

    if (!note) {
      throw DendronError.createFromStatus({
        message: `SidebarItem \`${item.id}\` does not exist`,
        status: ERROR_STATUS.DOES_NOT_EXIST,
      });
    }

    return note.children;
  }

  function generateSidebar(
    noteIds: DNodePointer[]
  ): WithPosition<SidebarItem>[] {
    return noteIds
      .map((noteId) => {
        const note = notesById[noteId];
        const fm = PublishUtils.getPublishFM(note);
        const { children } = note;
        const hasChildren = children.length > 0;
        const isCategory = hasChildren;
        const isNote = !hasChildren;

        if (!note) {
          return undefined;
        }

        const positionalProps = {
          position: fm.nav_order,
          fname: note.fname,
          reverse: fm.sort_order === "reverse",
        };

        if (isNote) {
          return {
            type: "note",
            id: note.id,
            label: note.title,
            ...positionalProps,
          } as SidebarItemNote;
        }

        if (isCategory) {
          return {
            type: "category",
            label: note.title,
            items: generateSidebar(children),
            link: { type: "note", id: note.id },
            ...positionalProps,
          } as SidebarItemCategory;
        }

        return undefined;
      })
      .filter((maybeSidebarItem): maybeSidebarItem is SidebarItem =>
        Boolean(maybeSidebarItem)
      );
  }

  function sortItems(sidebarItems: WithPosition<SidebarItem>[]): Sidebar {
    const processedSidebarItems = sidebarItems.map((item) => {
      if (item.type === "category") {
        const sortedItems = sortItems(item.items);
        if (item.reverse) {
          sortedItems.reverse();
        }
        return { ...item, items: sortedItems };
      }
      return item;
    });
    const sortedSidebarItems = _.sortBy(processedSidebarItems, [
      "position",
      "fname",
    ]);
    return sortedSidebarItems.map(
      ({ position, fname, reverse, ...item }) => item
    );
  }

  const hierarchySource = findHierarchySources();

  return _.flow(generateSidebar, sortItems)(hierarchySource);
};

function processSiderbar(
  sidebar: SidebarConfig,
  { notes, duplicateNoteBehavior }: SidebarOptions
): DendronResult<Sidebar> {
  function processAutoGeneratedItem(item: SidebarItemAutogenerated) {
    return (
      // optional future feature to control sidebarItems generation
      defaultSidebarItemsGenerator({ item, notes })
    );
  }

  function resolveItem(item: SidebarItemConfig): SidebarItemConfig {
    function resolveItemId(sidebarId: string) {
      const possibleNotes = [
        // 1. check if associated using note id.
        notes[sidebarId] ??
          // 2. find note based on `fname`
          Object.values(notes).filter((note) => {
            return note.fname === sidebarId;
          }),
      ].flat();

      const hasDuplicates = possibleNotes.length > 1;

      const note =
        // if more than a single note was found than use `duplicateNoteBehavior` to select a single note.
        (hasDuplicates &&
          do_(() => {
            const map = new Map(
              possibleNotes.map((note) => [
                note.vault.name ?? note.vault.fsPath,
                note,
              ])
            );
            return getPriorityVaults(duplicateNoteBehavior)
              ?.filter((vaultName) => map.has(vaultName))
              .map((vaultName) => map.get(vaultName))
              .at(0);
          })) ||
        // default to first
        possibleNotes.at(0);

      if (!note) {
        throw DendronError.createFromStatus({
          message: `SidebarItem \`${sidebarId}\` does not exist`,
          status: ERROR_STATUS.DOES_NOT_EXIST,
        });
      }
      return note.id;
    }

    const { type } = item;
    switch (type) {
      case "category": {
        const { link } = item;
        return {
          ...item,
          link: { type: "note", id: resolveItemId(link.id) },
        };
      }
      case "autogenerated": {
        return {
          ...item,
          id: item.id === ROOT_KEYWORD ? item.id : resolveItemId(item.id),
        };
      }
      case "note": {
        return {
          ...item,
          id: resolveItemId(item.id),
        };
      }
      default:
        assertUnreachable(type);
    }
  }

  function processItem(_item: SidebarItemConfig): SidebarItem[] {
    const item = resolveItem(_item);
    const { type } = item;
    switch (type) {
      case "category": {
        return [
          {
            ...item,
            items: item.items.map(processItem).flat(),
          },
        ];
      }
      case "autogenerated":
        return processAutoGeneratedItem(item);
      case "note": {
        return [item];
      }
      default:
        assertUnreachable(type);
    }
  }

  const safeProcessItem = fromThrowable(processItem, (error: unknown) =>
    DendronError.isDendronError(error)
      ? error
      : DendronError.createFromStatus({
          message: "Error when processing sidebarItem",
          status: ERROR_STATUS.INVALID_CONFIG,
        })
  );

  return Result.combine(sidebar.map(safeProcessItem)).map((x) => x.flat());
}

function processSidebars(
  sidebarsResult: DendronResult<SidebarsConfig>,
  options: SidebarOptions
): DendronResult<Sidebars> {
  return sidebarsResult
    .andThen((sidebars) => {
      return Result.combine(
        Object.entries(sidebars).map(([key, sidebar]) => {
          const sidebarResult = processSiderbar(sidebar, options);
          if (sidebarResult.isOk()) {
            return ok([key, sidebarResult.value] as const);
          }
          return err(sidebarResult.error);
        })
      );
    })
    .map((sidebarsEntries) => {
      return Object.fromEntries(sidebarsEntries);
    });
}

export function getSidebars(
  input: unknown,
  options: SidebarOptions
): DendronResult<Sidebars> {
  return processSidebars(parse(sidebarsConfig, input), options);
}

/**
 * Returns list of vault names ordered by priority
 */
function getPriorityVaults(
  duplicateNoteBehavior?: DuplicateNoteBehavior
): Option<string[]> {
  if (Array.isArray(duplicateNoteBehavior?.payload)) {
    return [...new Set(duplicateNoteBehavior?.payload)];
  }
  const vaultName = duplicateNoteBehavior?.payload.vault?.name;
  if (vaultName) {
    return [vaultName];
  }
  return undefined;
}
